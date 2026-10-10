import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginServerContext, PluginSettingsState } from '@getpaseo/plugin/server';
import { DEFAULT_PREFERENCES, preferences } from '../shared/preferences.ts';
import { OverviewQuerySchema } from '../shared/reporting.ts';
import { finalizeTurn } from '../shared/aggregate.ts';

test('cached reporting windows refresh after ledger appends and pricing preference changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-ledger-reporting-cache-'));
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const dir = join(home, 'plugins/token-ledger');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pricing.json'), JSON.stringify({ version: 1, currency: 'USD', prices: [] }));
  await writeFile(join(dir, 'openrouter-pricing.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), prices: [] }));
  type State = PluginSettingsState<typeof preferences.schema>;
  let notify!: (state: State) => void;
  const { initializePreferences } = await import('./preferences.ts');
  const settings = initializePreferences({ registerSettings: () => ({
    read: async () => ({ status: 'ready', revision: 'initial', values: DEFAULT_PREFERENCES }),
    subscribe: (listener: typeof notify) => { notify = listener; return () => {}; },
  }) } as unknown as PluginServerContext);
  try {
    await settings.ready;
    const store = await import('./store.ts');
    const { ensurePricing } = await import('./pricing.ts');
    const { readOverview } = await import('./read-model.ts');
    await ensurePricing();
    const base = { agentId: 'a', turnId: 't1', provider: 'claude', model: 'claude-opus-5.5',
      startedAt: null, endedAt: '2026-10-01T12:00:00Z', status: 'completed' as const, observations: [], prevSessionCostUsd: 0 };
    await store.appendRecord(finalizeTurn({ ...base, finalUsage: { inputTokens: 1_000_000, totalCostUsd: 2 } }));
    const query = OverviewQuerySchema.parse({ granularity: 'month' });
    assert.equal(readOverview(query).totals.effectiveCostUsd, 2);
    await store.appendRecord(finalizeTurn({ ...base, turnId: 't2', endedAt: '2026-11-01T12:00:00Z', finalUsage: { inputTokens: 1_000_000 } }));
    const updated = readOverview(query);
    assert.equal(updated.totals.turns, 2);
    assert.equal(updated.totals.effectiveCostUsd, 6);
    assert.equal(updated.totals.estimatedTurns, 1);
    assert.equal(readOverview(OverviewQuerySchema.parse({ endDate: '2026-10-31' })).totals.turns, 1);
    notify({ status: 'ready', revision: 'disabled', values: { ...DEFAULT_PREFERENCES, builtinPricing: false, openRouterPricing: false } });
    const repriced = readOverview(query);
    assert.equal(repriced.totals.effectiveCostUsd, 2, 'reported cost remains authoritative');
    assert.equal(repriced.totals.unpricedTurns, 1, 'cached estimates must not survive disabled reference prices');
  } finally {
    await settings.dispose();
    if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
