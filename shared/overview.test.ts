import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OverviewOutputSchema, type TurnRow, type OverviewResult } from './ledger.ts';
import { OverviewQuerySchema, ReportingWindowSchema } from './reporting.ts';
import { preferences } from './preferences.ts';
import { aggregateOverview, mergeOverviews, totalTokens } from './overview.ts';
import { OverviewSources } from './overview-sources.ts';

function row(endedAt: string, patch: Partial<TurnRow> = {}): TurnRow {
  return { v: 1, id: endedAt, seq: 1, agentId: 'a', turnId: 'foreground-turn-1', provider: 'claude', model: 'model-a',
    startedAt: null, endedAt, durationMs: null, status: 'completed', input: 10, cached: 20, output: 5,
    costUsd: 0.1, sessionCostUsd: 0.1, modelCalls: 1, quality: 'exact', source: 'turn_usage',
    effectiveCostUsd: 0.1, costSource: 'reported', costBreakdown: null, ...patch };
}
const query = OverviewQuerySchema.parse({});
function server(id: string, rows: TurnRow[] = [row('2026-10-10T12:00:00Z')]): OverviewResult {
  return OverviewOutputSchema.parse({ server: { id, label: id }, activeTurns: 0, ...aggregateOverview(rows, query) });
}

test('reporting settings accept old preferences, open windows and leap dates, rejecting impossible/reversed dates', () => {
  assert.equal(preferences.schema.parse({ timelineSummaries: false }).subscriptionStartDate, null);
  assert.equal(ReportingWindowSchema.safeParse({ subscriptionStartDate: '2024-02-29' }).success, true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', 'not a date']) {
    assert.equal(OverviewQuerySchema.safeParse({ startDate: date }).success, false, date);
  }
  assert.equal(OverviewQuerySchema.safeParse({ timeZone: 'Mars/Orbit' }).success, false);
  assert.equal(preferences.schema.safeParse({ subscriptionStartDate: '2026-10-11', subscriptionEndDate: '2026-10-10' }).success, false);
  assert.equal(OverviewQuerySchema.safeParse({ startDate: '2026-10-11', endDate: '2026-10-10' }).success, false);
});

test('inclusive dates use the client time zone on every server, including DST transitions', () => {
  const rows = [
    row('2026-03-28T22:59:59.999Z'), // previous local day
    row('2026-03-28T23:00:00Z'), // midnight in Stockholm
    row('2026-03-29T00:59:59Z'),
    row('2026-03-29T01:00:00Z'), // clock jumps to 03:00
    row('2026-03-29T21:59:59.999Z'), // end of 23-hour day
    row('2026-03-29T22:00:00Z'), // following local day
  ];
  const result = aggregateOverview(rows, OverviewQuerySchema.parse({ startDate: '2026-03-29', endDate: '2026-03-29', timeZone: 'Europe/Stockholm' }));
  assert.equal(result.totals.turns, 4);
  assert.deepEqual(result.periods.map((p) => p.period), ['2026-03-29']);
  assert.equal(result.firstRecordedAt, '2026-03-28T22:59:59.999Z');
  const fall = aggregateOverview([row('2026-10-25T00:30:00Z'), row('2026-10-25T01:30:00Z')],
    OverviewQuerySchema.parse({ startDate: '2026-10-25', endDate: '2026-10-25', timeZone: 'Europe/Stockholm' }));
  assert.equal(fall.totals.turns, 2, 'both instances of the repeated local hour count');
});

test('month and year boundaries, models, missing prices and known cache writes preserve their meaning', () => {
  const rows = [row('2025-12-31T23:59:59Z'), row('2026-01-01T00:00:00Z', { model: 'model-b', cacheWrite: 3, costUsd: null, effectiveCostUsd: 0.2, costSource: 'override', quality: 'partial' }),
    row('2026-02-01T00:00:00Z', { model: null, costUsd: null, effectiveCostUsd: null, costSource: null, usageGap: true })];
  const monthly = aggregateOverview(rows, OverviewQuerySchema.parse({ granularity: 'month' }));
  assert.deepEqual(monthly.periods.map((p) => p.period), ['2025-12', '2026-01', '2026-02']);
  assert.equal(monthly.totals.turns, 3);
  assert.equal(monthly.totals.costUsd, 0.1);
  assert.equal(monthly.totals.effectiveCostUsd, 0.3);
  assert.equal(monthly.totals.estimatedTurns, 1);
  assert.equal(monthly.totals.unpricedTurns, 1);
  assert.equal(monthly.totals.cacheWrite, 3);
  assert.equal(totalTokens(monthly.totals), 108);
  assert.equal(monthly.gapTurns, 1);
  const yearly = aggregateOverview(rows, OverviewQuerySchema.parse({ granularity: 'year' }));
  assert.deepEqual(yearly.periods.map((p) => [p.period, p.summary.turns]), [['2025', 1], ['2026', 2]]);
  const filtered = aggregateOverview(rows, OverviewQuerySchema.parse({ model: 'model-b' }));
  assert.equal(filtered.totals.turns, 1);
  assert.deepEqual(filtered.availableModels, [null, 'model-a', 'model-b']);
  assert.equal(filtered.partialTurns, 1);
  const unknown = aggregateOverview(rows, OverviewQuerySchema.parse({ model: null }));
  assert.equal(unknown.totals.turns, 1);
  assert.equal(unknown.totals.effectiveCostUsd, null);
  assert.equal(aggregateOverview(rows, OverviewQuerySchema.parse({ model: 'absent' })).totals.turns, 0);
});

test('merging independent ledgers sums matching periods/models and deduplicates the same daemon', () => {
  // These records deliberately reuse agent/turn/record IDs on different servers.
  const a = server('a');
  const b = server('b', [row('2026-10-10T12:00:00Z', { effectiveCostUsd: null, costUsd: null, costSource: null }), row('2026-10-11T12:00:00Z')]);
  const result = mergeOverviews([a, b, a]);
  assert.equal(result.servers.length, 2);
  assert.equal(result.totals.turns, 3);
  assert.equal(result.totals.input, 30);
  assert.equal(result.totals.effectiveCostUsd, 0.2);
  assert.equal(result.totals.unpricedTurns, 1);
  assert.equal(result.periods[0].summary.turns, 2);
  assert.equal(result.models[0].summary.turns, 3);
  assert.equal(mergeOverviews([]).totals.effectiveCostUsd, null);
});

test('server fan-out isolates errors/timeouts, forwards one shared query, and discards unloaded callbacks', async () => {
  const sources = new OverviewSources();
  let changes = 0;
  const unsubscribe = sources.subscribe(() => { changes++; });
  const ok = sources.register(async (input) => { assert.equal(input, query); return server('good'); });
  const failed = sources.register(async () => { throw new Error('disconnected'); });
  failed.setLabel('Remote');
  const hanging = sources.register(() => new Promise(() => {}));
  let resolve!: (result: OverviewResult) => void;
  const removed = sources.register(() => new Promise((done) => { resolve = done; }));
  const pending = sources.query(query, 20);
  await Promise.resolve();
  removed.release();
  resolve(server('removed'));
  const result = await pending;
  assert.equal(result.servers.length, 1);
  assert.equal(result.totals.turns, 1);
  assert.deepEqual(result.failures.map((f) => f.error).sort(), ['Usage request timed out', 'disconnected']);
  assert.equal(result.failures.find((f) => f.error === 'disconnected')?.label, 'Remote');
  const revision = sources.snapshot();
  sources.invalidate();
  assert.equal(sources.snapshot(), revision + 1);
  ok.release(); failed.release(); hanging.release(); removed.release();
  assert.equal(changes, 9);
  unsubscribe();
  assert.equal((await sources.query(query)).servers.length, 0);
});
