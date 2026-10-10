# Overview reporting

The Overview combines finished-turn usage from connected Paseo servers with this
TokenLedger client version loaded. It shows totals, time buckets, model totals
and server coverage, with no conversation breakdown. Session panels and composer
pills continue to use their own server's ledger.

## Dates and filters

Use **Subscription dates** in the Overview, or **Subscription window** in plugin
settings, to save start/end dates. Both boundaries are inclusive. Leave start
blank for all available history or end blank for ongoing usage. Impossible dates
and reversed windows are rejected. Existing settings receive open dates by
default without a migration or reset.

One reporting window applies to every server queried by that Overview. Paseo's
settings documents are host scoped: the selected host persists the window and
shares it with its clients. Switching the Overview's host selects that host's
saved window; servers are never queried using independent per-server windows.

**Daily**, **Monthly** and **Yearly** group finished turns by their completion
date in the viewing client's IANA time zone. Every source receives the same time
zone, dates and model selection. Daylight-saving changes use calendar dates
rather than a fixed 24-hour interval. A turn spanning midnight belongs to the
day on which it finished. Only periods with records are displayed.

**All models** combines models. Specific filters use the model recorded on each
turn; changing an agent's current model does not relabel history. **Unknown
model** selects records whose model was not reported. Model choices come from
usage inside the date window, independent of the selected model.

## Server discovery and failures

Paseo loads one client contribution per connected plugin installation in the app's
JavaScript runtime. Each contribution registers its own typed `client.rpc`
callback in a versioned, namespaced `Symbol.for` registry. The Overview fans out
through those callbacks; it does not use private host APIs, create connections,
or transfer credentials. This is necessary because the public `PaseoApi` does
not expose cross-host plugin RPC. The registry exchanges only aggregate usage.

Install or update this version on all servers and reopen an app window holding
an old bundle. Servers without this client contribution cannot participate.
Disconnected servers and failed or timed-out requests are excluded and shown in
the Overview. No cached offline data is presented as current usage. Each source
has a ten-second request deadline, so one unavailable server does not discard
the other results.

A persistent `server-identity.json` beside the ledger identifies that ledger;
connecting to one daemon under multiple app host entries does not double its
totals. Distinct servers remain separate even if their record, agent or turn IDs
coincide. Unload removes an installation's callback and event listener; late
responses from a removed installation are discarded. Live agent observations
invalidate the Overview with a bounded delay; normal fallback polling remains.

Each server normalizes its own records and uses its own pricing configuration.
The app sums those results without repricing them. Reported, estimated and
unpriced cost counters retain their meaning. In-progress turns are counted as
activity, and totals include only finished turns. Partial usage and tracking
gaps remain visible.

Normalized records are reused from the server read model. Up to twenty reporting
queries are cached per ledger/pricing revision; price changes and new records
invalidate those aggregates, while activity counts remain live.

## History

The ledger no longer trims at the former 2,000-turn limit. This retains future
history for monthly and yearly reporting; disk and memory use grow with recorded
turns. Previously trimmed records cannot be reconstructed. Each included server
shows its earliest/latest available record so coverage can be assessed. Changing
subscription dates never deletes records or changes tracking.

Tests cover legacy preferences, date validation, inclusive boundaries, daylight
saving, month/year boundaries, model selection, cost provenance, cache writes,
merging independent servers, duplicate connections, timeouts and unload races.
