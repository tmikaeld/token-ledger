/**
 * Per-model pricing used to estimate a cost breakdown per turn. Upstream only
 * reports a total costUsd, never per-component costs, so the split shown in
 * the UI is an estimate: token counts × list price. When a real total exists,
 * the difference between it and the estimate is surfaced as `otherUsd` rather
 * than smeared across the components. Missing upstream usage (including
 * cache writes in Paseo 0.8) can contribute to that residual.
 *
 * Prices are $/MTok. Cache write is independent of the input/read rates;
 * neither cache lifetime nor a provider's write premium is inferred.
 */
export type ModelPricing = {
  input: number;
  cacheRead: number;
  /** Omitted in older price files; writes then use the ordinary input rate. */
  cacheWrite?: number;
  output: number;
};

// Standard-mode list prices verified 2026-09-23:
// https://platform.claude.com/docs/en/about-claude/pricing
// Explicit versions prevent new models or Fast/Batch suffixes inheriting old rates.
const PRICING_TABLE: Array<[RegExp, ModelPricing]> = [
  [/^claude-(?:fable|mythos)-5-1$/, { input: 10, cacheRead: 0.25, output: 50 }],
  [/^claude-(?:fable|mythos)-5$/, { input: 10, cacheRead: 1, output: 50 }],
  [/^claude-opus-5-5$/, { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 }],
  [/^claude-opus-(?:5|4-[5-8])$/, { input: 5, cacheRead: 0.5, output: 25 }],
  [/^claude-opus-4(?:-1)?$/, { input: 15, cacheRead: 1.5, output: 75 }],
  [/^claude-sonnet-5$/, { input: 2, cacheRead: 0.2, output: 10 }],
  [/^claude-sonnet-4(?:-[56])?$/, { input: 3, cacheRead: 0.3, output: 15 }],
  [/^claude-haiku-4-5$/, { input: 1, cacheRead: 0.1, output: 5 }],
  [/^claude-haiku-3-5$/, { input: 0.8, cacheRead: 0.08, output: 4 }],
];

const MAX_CANONICAL_CACHE_ENTRIES = 10_000;
const canonicalCache = new Map<string, string>();
export function canonicalModel(value: string): string {
  const hit = canonicalCache.get(value);
  if (hit !== undefined) return hit;
  if (canonicalCache.size >= MAX_CANONICAL_CACHE_ENTRIES) canonicalCache.clear();
  const result = canonicalModelUncached(value);
  canonicalCache.set(value, result);
  return result;
}
function canonicalModelUncached(value: string): string {
  let model = value.trim().toLowerCase();
  if (model.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(model);
      if (Array.isArray(parsed) && typeof parsed.at(-1) === 'string') model = parsed.at(-1);
    } catch {}
  }
  model = model.split('/').at(-1) ?? model;
  return model.replace(/\[1m\]$/i, '').replace(/[._]/g, '-').replace(/-+/g, '-');
}

export function modelPricing(model: string | null): ModelPricing | null {
  if (!model) return null;
  const canonical = canonicalModel(model).replace(/-\d{8}$/, '');
  for (const [pattern, pricing] of PRICING_TABLE) {
    if (pattern.test(canonical)) return pricing;
  }
  return null;
}

export type CostBreakdown = {
  inUsd: number;
  cacheUsd: number;
  cacheWriteUsd?: number;
  outUsd: number;
  /**
   * costUsd minus the list-price estimate of the known components; null when
   * no real total was reported. Positive residual is cost the reported token
   * counts can't account for (chiefly cache writes on Claude); a small
   * negative residual just means the hardcoded list prices overestimate.
   */
  otherUsd: number | null;
};

const PER_MTOK = 1_000_000;

/**
 * Estimates per-component costs for a turn at list prices. When the turn
 * carries a real total (costUsd), the gap between total and estimate is
 * returned as otherUsd instead of being folded into the components. Returns
 * null when the model has no known pricing or no token counts were reported.
 */
export function costBreakdown(turn: {
  model: string | null;
  input: number | null;
  cached: number | null;
  cacheWrite?: number | null;
  output: number | null;
  costUsd: number | null;
}): CostBreakdown | null {
  const pricing = modelPricing(turn.model);
  if (!pricing) return null;
  return costBreakdownWithPricing(turn, pricing);
}

/** Computes a breakdown with pricing selected by the server. */
export function costBreakdownWithPricing(
  turn: { input: number | null; cached: number | null; cacheWrite?: number | null; output: number | null; costUsd: number | null },
  pricing: ModelPricing,
): CostBreakdown | null {
  if (turn.input === null && turn.cached === null && turn.output === null && turn.cacheWrite == null) return null;
  const inUsd = ((turn.input ?? 0) * pricing.input) / PER_MTOK;
  const cacheUsd = ((turn.cached ?? 0) * pricing.cacheRead) / PER_MTOK;
  const cacheWriteUsd = ((turn.cacheWrite ?? 0) * (pricing.cacheWrite ?? pricing.input)) / PER_MTOK;
  const outUsd = ((turn.output ?? 0) * pricing.output) / PER_MTOK;
  const otherUsd = turn.costUsd !== null ? turn.costUsd - (inUsd + cacheUsd + cacheWriteUsd + outUsd) : null;
  return { inUsd, cacheUsd, ...(turn.cacheWrite != null ? { cacheWriteUsd } : {}), outUsd, otherUsd };
}

/**
 * Share of prompt tokens served from cache: cached / (input + cached + writes).
 * Expects input in canonical fresh-token form (see semantics.ts) — the server
 * normalizes inclusive-input providers before values reach clients.
 */
export function cacheRatio(input: number | null, cached: number | null, cacheWrite?: number | null): number | null {
  if (cached === null) return null;
  const prompt = (input ?? 0) + cached + (cacheWrite ?? 0);
  if (prompt <= 0) return null;
  return cached / prompt;
}
