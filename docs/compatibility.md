# Paseo compatibility

TokenLedger's manifest allows **Paseo >=0.9.1**, on both the daemon and the app.
This policy applies from TokenLedger v0.6.3; v0.6.2 still has the `<0.10.0`
ceiling.

## Policy

- **Minimum version:** keep 0.9.1 because the plugin uses its owned catalog
  subscriptions, recovery behavior, and settings API. Raise the minimum only
  when a required API cannot reasonably be supported on the previous baseline.
- **No speculative upper limit:** a new Paseo release should not automatically
  disable TokenLedger. Investigate actual API or accounting changes; restrict
  a range only when an incompatibility is confirmed and cannot be adapted.
- **Verified versions are separate:** accepting a version permits loading; it
  does not certify untested future behavior. Paseo is still pre-1.0, so a minor
  release can introduce breaking changes even without a major version bump.
- **Pinned build baseline:** keep `@getpaseo/plugin`, `@getpaseo/client`, and
  `@getpaseo/protocol` pinned together at 0.9.1. The client/protocol imports in
  shipped code are type-only, and Paseo supplies the plugin runtime and
  `PaseoApi`. Updating the host does not require updating these pins in lockstep.
- **Ongoing checks:** CI runs the typecheck and existing tests against 0.9.1,
  0.10.2, 0.11.1, and npm `latest`, on pushes, PRs, manual runs, and weekly. These checks
  detect type and SDK regressions; real provider turns remain necessary to
  verify token/cost semantics and host behavior. CI failures do not silently
  rewrite the compatibility range or disable installed plugins.

Do not remove `requirements.paseo`: Paseo 0.10.2 treats an omitted declaration
as a legacy `<0.8.0` plugin. Use the explicit lower bound. The current host also
checks prereleases against their stable version core, so the range alone does
not exclude beta builds.

## Verification record

| Paseo | Evidence | Result |
| --- | --- | --- |
| 0.9.1 | Original host validation on 2026-09-23; baseline typecheck and 65 tests rerun on 2026-09-30 | Supported minimum; see [v0.6.0 verification](releases/v0.6.0.md) |
| 0.10.2 | Installed desktop/daemon, published SDK, typecheck, 65 tests, plugin reload, real Claude/Codex turns on 2026-09-30 | Compatible with existing implementation after removing the manifest ceiling |
| 0.11.1 | Overview feature validation on 2026-10-10: two isolated daemon installs/reloads, generated client bundles, real plugin RPCs with synthetic ledgers, subscription settings, date/model filters, duplicate connection and unload cleanup | Overview runtime checks passed; interactive desktop/mobile walkthrough and new real provider turns were not performed |

The 0.10.2 investigation found:

- The original startup failure was the `>=0.9.1 <0.10.0` manifest check,
  before compilation. Changing the range restored `running`; both bundles
  compiled and the server initialized without new plugin errors.
- All 22 plugin SDK declaration files are unchanged from 0.9.1. The client
  changes concern connection/authentication, and protocol changes include
  handshake fields. The usage contract and public APIs used here remain
  compatible. See the [upstream comparison](https://github.com/getpaseo/paseo/compare/v0.9.1...v0.10.2)
  and [0.10.2 release](https://github.com/getpaseo/paseo/releases/tag/v0.10.2).
- Two Claude turns, separated by a plugin reload, each produced one completed
  record. Provider session identity and the cumulative-cost baseline survived;
  the second record stored the cost difference rounded to six decimal places.
- A Codex turn with a shell call produced one completed record with two request
  observations; its input, cache, and output totals equal their request sums.
- The installed provider source still omits cache-write counts and Codex
  provider-internal child usage. This upgrade does not resolve the existing
  [usage API gaps](paseo-usage-api.md).

This review checked client types and bundle compilation, not an interactive
desktop/mobile UI walkthrough. It did not repeat every 0.9.1 failure-injection
scenario against the live daemon, and it does not certify other providers or
future Paseo releases. Test agents were archived after verification.
