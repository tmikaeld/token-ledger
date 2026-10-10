import type { OverviewResult, Summary, TurnRow } from './ledger.ts';
import type { OverviewQuery } from './reporting.ts';

export const emptySummary = (): Summary => ({
  turns: 0, input: 0, cached: 0, output: 0, costUsd: null,
  effectiveCostUsd: null, estimatedTurns: 0, unpricedTurns: 0,
});

export function addSummary(target: Summary, source: Summary): void {
  for (const key of ['turns', 'input', 'cached', 'output', 'estimatedTurns', 'unpricedTurns'] as const) target[key] += source[key];
  if (source.cacheWrite != null) target.cacheWrite = (target.cacheWrite ?? 0) + source.cacheWrite;
  if (source.costUsd != null) target.costUsd = (target.costUsd ?? 0) + source.costUsd;
  if (source.effectiveCostUsd != null) target.effectiveCostUsd = (target.effectiveCostUsd ?? 0) + source.effectiveCostUsd;
}

function addRow(target: Summary, row: TurnRow): void {
  addSummary(target, {
    turns: 1, input: row.input ?? 0, cached: row.cached ?? 0,
    cacheWrite: row.cacheWrite ?? undefined, output: row.output ?? 0,
    costUsd: row.costUsd, effectiveCostUsd: row.effectiveCostUsd,
    estimatedTurns: Number(row.effectiveCostUsd !== null && row.costSource !== 'reported'),
    unpricedTurns: Number(row.effectiveCostUsd === null),
  });
}

function roundSummary(summary: Summary): Summary {
  if (summary.costUsd !== null) summary.costUsd = Number(summary.costUsd.toFixed(6));
  if (summary.effectiveCostUsd !== null) summary.effectiveCostUsd = Number(summary.effectiveCostUsd.toFixed(6));
  return summary;
}

function grouped<K extends string | null>(groups: Map<K, Summary>, key: K): Summary {
  let summary = groups.get(key);
  if (!summary) { summary = emptySummary(); groups.set(key, summary); }
  return summary;
}

export function aggregateOverview(rows: readonly TurnRow[], query: OverviewQuery): Omit<OverviewResult, 'server' | 'activeTurns'> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: query.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const totals = emptySummary();
  const periods = new Map<string, Summary>();
  const models = new Map<string | null, Summary>();
  const availableModels = new Set<string | null>();
  let firstRecordedAt: string | null = null;
  let lastRecordedAt: string | null = null;
  let partialTurns = 0;
  let gapTurns = 0;
  for (const row of rows) {
    const timestamp = new Date(row.endedAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const iso = timestamp.toISOString();
    if (firstRecordedAt === null || iso < firstRecordedAt) firstRecordedAt = iso;
    if (lastRecordedAt === null || iso > lastRecordedAt) lastRecordedAt = iso;
    const parts = formatter.formatToParts(timestamp);
    const part = (key: string) => parts.find((p) => p.type === key)!.value;
    const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    if ((query.startDate && day < query.startDate) || (query.endDate && day > query.endDate)) continue;
    availableModels.add(row.model);
    if (query.model !== undefined && row.model !== query.model) continue;
    const period = day.slice(0, query.granularity === 'year' ? 4 : query.granularity === 'month' ? 7 : 10);
    addRow(totals, row);
    addRow(grouped(periods, period), row);
    addRow(grouped(models, row.model), row);
    partialTurns += Number(row.quality !== 'exact');
    gapTurns += Number(!!row.usageGap);
  }
  return {
    totals: roundSummary(totals),
    periods: [...periods].sort(([a], [b]) => a.localeCompare(b)).map(([period, summary]) => ({ period, summary: roundSummary(summary) })),
    models: [...models].map(([model, summary]) => ({ model, summary: roundSummary(summary) }))
      .sort((a, b) => totalTokens(b.summary) - totalTokens(a.summary) || (a.model ?? '').localeCompare(b.model ?? '')),
    availableModels: [...availableModels].sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    firstRecordedAt, lastRecordedAt, partialTurns, gapTurns,
  };
}

export function totalTokens(summary: Summary): number {
  return summary.input + summary.cached + (summary.cacheWrite ?? 0) + summary.output;
}

/** Each server's own pricing and token normalization is authoritative. */
export function mergeOverviews(results: readonly OverviewResult[]) {
  const servers = [...new Map(results.map((result) => [result.server.id, result])).values()];
  const totals = emptySummary();
  const periods = new Map<string, Summary>();
  const models = new Map<string | null, Summary>();
  const availableModels = new Set<string | null>();
  let activeTurns = 0;
  let partialTurns = 0;
  let gapTurns = 0;
  for (const server of servers) {
    addSummary(totals, server.totals);
    for (const row of server.periods) addSummary(grouped(periods, row.period), row.summary);
    for (const row of server.models) addSummary(grouped(models, row.model), row.summary);
    for (const model of server.availableModels) availableModels.add(model);
    activeTurns += server.activeTurns;
    partialTurns += server.partialTurns;
    gapTurns += server.gapTurns;
  }
  return {
    servers, totals: roundSummary(totals), activeTurns, partialTurns, gapTurns,
    periods: [...periods].sort(([a], [b]) => a.localeCompare(b)).map(([period, summary]) => ({ period, summary: roundSummary(summary) })),
    models: [...models].map(([model, summary]) => ({ model, summary: roundSummary(summary) }))
      .sort((a, b) => totalTokens(b.summary) - totalTokens(a.summary) || (a.model ?? '').localeCompare(b.model ?? '')),
    availableModels: [...availableModels].sort((a, b) => (a ?? '').localeCompare(b ?? '')),
  };
}
