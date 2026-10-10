import type { OverviewResult } from './ledger.ts';
import type { OverviewQuery } from './reporting.ts';
import { mergeOverviews } from './overview.ts';

type Source = { query(input: OverviewQuery): Promise<OverviewResult>; label: string; boundLabel?: string };

/** RPC callbacks stay owned by their originating plugin installation. */
export class OverviewSources {
  private sources = new Set<Source>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private next = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  invalidate = () => { this.revision++; for (const listener of this.listeners) listener(); };

  register(query: Source['query']) {
    const source: Source = { query, label: `Server ${++this.next}` };
    this.sources.add(source);
    this.invalidate();
    return {
      setLabel: (label: string) => { source.label = label; source.boundLabel = label; },
      release: () => { if (this.sources.delete(source)) this.invalidate(); },
    };
  }

  async query(input: OverviewQuery, timeoutMs = 10_000) {
    const sources = [...this.sources];
    const responses = await Promise.allSettled(sources.map(async (source) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.resolve().then(() => source.query(input)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Usage request timed out')), timeoutMs); }),
        ]);
      } finally { clearTimeout(timer); }
    }));
    const results: OverviewResult[] = [];
    const failures: Array<{ label: string; error: string }> = [];
    for (let i = 0; i < responses.length; i++) {
      const source = sources[i]!;
      // An unload/reload while the request was pending invalidates its response.
      if (!this.sources.has(source)) continue;
      const response = responses[i]!;
      if (response.status === 'fulfilled') {
        source.label = source.boundLabel ?? response.value.server.label;
        results.push({ ...response.value, server: { ...response.value.server, label: source.label } });
      } else failures.push({ label: source.label, error: response.reason instanceof Error ? response.reason.message : String(response.reason) });
    }
    return { ...mergeOverviews(results), failures };
  }
}
