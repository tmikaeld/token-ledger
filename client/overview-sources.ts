import type { PluginClientContext } from '@getpaseo/plugin/client';
import { OverviewSources } from '../shared/overview-sources.ts';
import { ledgerOverview } from '../shared/ledger.ts';

// Paseo evaluates each host's client bundle in the same JS runtime. A versioned
// symbol lets our installations discover one another without private host APIs,
// new sockets, credentials, or changes to the borrowed PaseoApi.
const key = Symbol.for('stv1024.token-ledger.overview-sources.v1');
const runtime = globalThis as unknown as Record<symbol, OverviewSources | undefined>;
export const overviewSources = runtime[key] ??= new OverviewSources();

let labelSource: ((label: string) => void) | undefined;
export function labelOverviewSource(label: string): void { labelSource?.(label); }

export function contributeOverviewSource(client: PluginClientContext): () => void {
  const source = overviewSources.register((query) => client.rpc(ledgerOverview, query));
  labelSource = source.setLabel;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fingerprints = new Map<string, string>();
  const unsubscribe = client.paseo.agents.subscribe((event) => {
    const id = event.kind === 'upsert' ? event.agent.id : event.agentId;
    const fingerprint = event.kind === 'upsert'
      ? JSON.stringify([event.agent.activeTurn, event.agent.lastUsage, event.agent.model, event.agent.status]) : 'removed';
    if (fingerprints.get(id) === fingerprint) return;
    fingerprints.set(id, fingerprint);
    timer ??= setTimeout(() => { timer = undefined; overviewSources.invalidate(); }, 500);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
    labelSource = undefined;
    source.release();
  };
}
