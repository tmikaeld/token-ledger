import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('OpenRouter index preserves ambiguous matches and precedence, and replaces changed or removed catalog entries', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-ledger-pricing-index-'));
  const previousHome = process.env.PASEO_HOME;
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  process.env.PASEO_HOME = home;
  const dir = join(home, 'plugins/token-ledger');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pricing.json'), JSON.stringify({ version: 1, currency: 'USD', prices: [
    { providers: ['codex'], model: 'override-target', tiers: [{ input: 23, cacheRead: 0, output: 0 }] },
  ] }));
  const entry = (id: string, prompt: number) => ({ id, prompt, cacheRead: 0, completion: 0 });
  await writeFile(join(dir, 'openrouter-pricing.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), prices: [
    entry('vendor/unique.model', 3),
    entry('a/collision-model', 1), entry('b/collision_model', 2),
    entry('vendor/remove-me', 5), entry('vendor/now-ambiguous', 7),
    entry('vendor/exact-duplicate', 9), entry('vendor/exact-duplicate', 9),
    entry('vendor/override-target', 29),
  ] }));
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return new Response(JSON.stringify({ data: [
      { id: 'vendor/unique-model', pricing: { prompt: '0.000004', completion: '0' } },
      { id: 'a/collision-model', pricing: { prompt: '0.000011', completion: '0' } },
      { id: 'a/now-ambiguous', pricing: { prompt: '0.000013', completion: '0' } },
      { id: 'b/now_ambiguous', pricing: { prompt: '0.000017', completion: '0' } },
      { id: 'vendor/added-model', pricing: { prompt: '0.000019', completion: '0' } },
    ] }));
  };
  try {
    const pricing = await import('./pricing.ts');
    await pricing.ensurePricing();
    const cost = (model: string, provider = 'codex') => pricing.estimateUsageCost({
      provider, model, input: 1_000_000, cached: 0, output: 0,
    });
    assert.equal(fetches, 0, 'a fresh disk catalog does not need network access');
    assert.equal(cost('UNIQUE_MODEL').effectiveCostUsd, 3);
    assert.equal(cost('vendor/unique.model').costSource, 'openrouter');
    assert.equal(cost('a/collision-model').effectiveCostUsd, null, 'even an exact ID is ambiguous after canonicalization');
    assert.equal(cost('exact-duplicate').effectiveCostUsd, null, 'identical duplicate rows remain ambiguous');
    assert.equal(cost('remove-me').effectiveCostUsd, 5);
    assert.equal(cost('now-ambiguous').effectiveCostUsd, 7);
    assert.equal(cost('override-target').effectiveCostUsd, 23);
    assert.equal(cost('override-target', 'claude').effectiveCostUsd, 29, 'custom pricing remains provider scoped');
    assert.equal(cost('unknown-model').effectiveCostUsd, null);

    const before = pricing.pricingRevision();
    Date.now = () => originalNow() + 25 * 60 * 60 * 1000;
    await pricing.ensurePricing();
    for (let i = 0; pricing.pricingRevision() === before && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fetches, 1);
    assert.notEqual(pricing.pricingRevision(), before);
    assert.equal(cost('unique.model').effectiveCostUsd, 4);
    assert.equal(cost('collision-model').effectiveCostUsd, 11, 'removing a conflicting alias restores pricing');
    assert.equal(cost('now-ambiguous').effectiveCostUsd, null, 'adding a conflicting alias invalidates a previously priced model');
    assert.equal(cost('remove-me').effectiveCostUsd, null, 'removed entries cannot survive in the index');
    assert.equal(cost('added-model').effectiveCostUsd, 19);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
