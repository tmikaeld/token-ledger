import type { Summary, TurnRecord, TurnRow } from '../shared/ledger.ts';
import { allRecords, storeRevision } from './store.ts';
import { enrichTurn, pricingRevision } from './pricing.ts';
import { aggregateOverview } from '../shared/overview.ts';
import type { OverviewQuery } from '../shared/reporting.ts';
export const EMPTY_SUMMARY: Summary = {
  turns: 0,
  input: 0,
  cached: 0,
  output: 0,
  costUsd: null,
  effectiveCostUsd: null,
  estimatedTurns: 0,
  unpricedTurns: 0,
};

function summaryFromRows(records: readonly TurnRow[]): Summary {
  const summary: Summary = { ...EMPTY_SUMMARY };
  for (const row of records) {
    summary.turns += 1;
    summary.input += row.input ?? 0;
    summary.cached += row.cached ?? 0;
    if (row.cacheWrite != null) summary.cacheWrite = (summary.cacheWrite ?? 0) + row.cacheWrite;
    summary.output += row.output ?? 0;
    if (row.costUsd !== null) summary.costUsd = (summary.costUsd ?? 0) + row.costUsd;
    if (row.effectiveCostUsd !== null) {
      summary.effectiveCostUsd = (summary.effectiveCostUsd ?? 0) + row.effectiveCostUsd;
      if (row.costSource !== "reported") summary.estimatedTurns += 1;
    } else {
      summary.unpricedTurns += 1;
    }
  }
  if (summary.costUsd !== null) summary.costUsd = Number(summary.costUsd.toFixed(6));
  if (summary.effectiveCostUsd !== null) summary.effectiveCostUsd = Number(summary.effectiveCostUsd.toFixed(6));
  return summary;
}


let revision = '';
let groups = new Map<string, {summary: Summary; rows: TurnRow[]; lastEndedAt: string | null}>();
let rows: TurnRow[] = [];
const overviews = new Map<string, ReturnType<typeof aggregateOverview>>();
export function readModel() {
  const current = storeRevision() + ':' + pricingRevision();
  if (current !== revision) {
    const raw = new Map<string, TurnRecord[]>();
    for (const record of allRecords()) {
      const group = raw.get(record.agentId) ?? [];
      group.push(record); raw.set(record.agentId, group);
    }
    groups = new Map([...raw].map(([id, records]) => {
      const rows = records.map((r, i) => enrichTurn(r, i + 1));
      return [id, { summary: summaryFromRows(rows), rows: rows.reverse(), lastEndedAt: records.at(-1)?.endedAt ?? null }];
    }));
    rows = [...groups.values()].flatMap((group) => group.rows);
    overviews.clear();
    revision = current;
  }
  return { revision, groups, rows };
}

/** Bound the number of cached windows; revisions invalidate prices and history together. */
export function readOverview(query: OverviewQuery) {
  const model = readModel();
  const key = JSON.stringify(query);
  let result = overviews.get(key);
  if (!result) {
    result = aggregateOverview(model.rows, query);
    if (overviews.size >= 20) overviews.delete(overviews.keys().next().value!);
    overviews.set(key, result);
  }
  return result;
}
