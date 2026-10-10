import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi, PaseoAgentTimelineEvent, PaseoAgentUpdate } from '@getpaseo/client';
import { ledgerSync, ledgerOverview } from '../shared/ledger.ts';
import { ownedSnapshot } from '../shared/subscription-test-helpers.ts';

test('tracker starts without UI, serves validated RPCs, normalizes raw disk usage, and cleans up', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-ledger-tracker-test-'));
  const oldHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const dir = join(home, 'plugins', 'token-ledger');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pricing.json'), JSON.stringify({version: 1, currency: 'USD', prices: [{
    providers: ['codex'], model: 'gpt-5', tiers: [{input: 10, cacheRead: 1, cacheWrite: 15, output: 20}],
  }]}));
  await writeFile(join(dir, 'openrouter-pricing.json'), JSON.stringify({fetchedAt: new Date().toISOString(), prices: []}));
  let update: (event: PaseoAgentUpdate) => void = () => {};
  let timeline: (event: PaseoAgentTimelineEvent) => void = () => {};
  let removed = 0;
  const published: Array<{id: string; data: {quality: string}}> = [];
  let catalogSubscriptions = 0;
  let listCalls = 0;
  const snapshot = { id: 'a', provider: 'codex', model: 'gpt-5', workspaceId: 'w', title: 'Test',
    status: 'idle', updatedAt: '2026-09-14T00:00:00Z', lastUsage: undefined };
  const handle = { refresh: async () => snapshot, current: () => snapshot,
    timeline: { append: async (item: {id: string; data: {quality: string}}) => {
      const lines = await readFile(join(dir, "ledger.jsonl"), "utf8");
      assert.ok(lines.includes(item.id.replace("token-ledger:", "")), "summary must follow durable append");
      published.push(item);
      if (published.length === 1) throw new Error("simulate uncertain transport acknowledgement");
      return {seq: 1, epoch: "test"};
    }, subscribe: (fn: typeof timeline) => { timeline = fn; return Object.assign(() => {}, { ready: Promise.resolve(), release: async () => { removed++; } }); } } };
  const paseo = { agents: {
    subscribe: (fn: typeof update) => { update = fn; catalogSubscriptions++; return () => { removed++; }; },
    list: async (options: {page?: {cursor?: string}; subscribe?: object}) => {
      listCalls++;
      if (options.page?.cursor) return { entries: [{agent: {...snapshot, id: "page-two", workspaceId: "w2", updatedAt: "2026-09-15T00:00:00Z", status: "closed"}}], pageInfo: {nextCursor: null} };
      const page = { entries: [{agent: snapshot}], pageInfo: {nextCursor: "next"} };
      if (!options.subscribe) return page;
      catalogSubscriptions++;
      const owned = ownedSnapshot(page, () => { removed++; });
      update = (event) => owned.update({ type: 'agent_update', payload: event });
      return owned.page;
    }, ref: () => handle,
  }, workspaces: { list: async () => ownedSnapshot({ entries: [{id: 'w', title: 'Workspace', name: 'workspace'}, {id: 'w2', title: 'Older Workspace', name: 'older-workspace'}], pageInfo: {nextCursor: null} }, () => { removed++; }).page } } as unknown as PaseoApi;
  const tracker = await import('./tracker.ts');
  const store = await import('./store.ts');
  try {
    await Promise.all([tracker.prepareAgent(paseo, 'a'), tracker.ensureTracker(paseo)]);
    assert.equal(catalogSubscriptions, 1);
    timeline({ agentId: 'a', timestamp: '2026-09-14T00:00:00Z', event: {type: 'turn_started', provider: 'codex', turnId: 't1'} });
    update({kind: 'upsert', agent: {...snapshot, activeTurn: {turnId: 't1', startedAt: '2026-09-14T00:00:00Z'},
      // Synthetic reducer extension: the current public Paseo type lacks writes.
      lastUsage: {inputTokens: 100, cachedInputTokens: 80, cacheWriteInputTokens: 10, outputTokens: 5}}} as unknown as PaseoAgentUpdate);
    const live = await tracker.handleSync({agentId: 'a'}, {paseo});
    assert.equal(live.inFlight?.input, 10);
    assert.equal(live.inFlight?.cacheWrite, 10);
    assert.equal(live.inFlight?.effectiveCostUsd, 0.00043);
    assert.equal(live.inFlight?.costSource, 'override');
    timeline({ agentId: 'a', timestamp: '2026-09-14T00:00:01Z', event: {type: 'turn_completed', provider: 'codex', turnId: 't1'} });
    const result = ledgerSync.output.parse(await tracker.handleSync({agentId: 'a'}, {paseo}));
    assert.equal(result.summary.turns, 1); assert.equal(result.records[0].input, 10);
    assert.equal(result.summary.cacheWrite, 10);
    assert.equal(result.records[0].requests?.[0].cacheWrite, 10);
    assert.equal(result.records[0].quality, 'partial'); assert.equal(store.allRecords()[0].input, 100);
    const unchanged = await tracker.handleSync({agentId: "a", knownRecordsRevision: result.recordsRevision}, {paseo});
    assert.deepEqual(unchanged.records, []);
    assert.deepEqual(unchanged.summary, result.summary);
    const beforeOverview = listCalls;
    const overview = ledgerOverview.output.parse(await tracker.handleOverview({}, {paseo}));
    assert.equal(overview.totals.turns, 1);
    assert.equal(overview.totals.cacheWrite, 10);
    assert.equal(overview.periods[0].period, '2026-09-14');
    assert.equal(overview.periods[0].summary.input, 10);
    assert.deepEqual(overview.availableModels, ['gpt-5']);
    assert.equal(overview.models[0].summary.cacheWrite, 10);
    assert.equal(overview.partialTurns, 1);
    assert.equal(overview.activeTurns, 0);
    assert.equal('groups' in overview, false, 'overview does not expose conversations');
    const excluded = await tracker.handleOverview({ startDate: '2026-09-15' }, { paseo });
    assert.equal(excluded.totals.turns, 0);
    const monthly = await tracker.handleOverview({ granularity: 'month', model: 'gpt-5' }, { paseo });
    assert.equal(monthly.periods[0].period, '2026-09');
    assert.equal(monthly.server.id, overview.server.id);
    await tracker.handleOverview({}, {paseo});
    assert.equal(listCalls, beforeOverview);
    await tracker.stopTracker(); assert.equal(removed, 2);
    assert.equal(published.length, 2);
    assert.equal(published[0].id, published[1].id);
    assert.equal(published[1].data.quality, "partial");
    timeline({ agentId: 'a', timestamp: '2026-09-14T00:00:02Z', event: {type: 'turn_started', provider: 'codex', turnId: 't2'} });
    assert.equal(store.allRecords().length, 1);
  } finally {
    await tracker.stopTracker();
    if (oldHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  }
});
