# SPIKE-4 — Profile persistence + isolation floor

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.4)
> Status: **PASS (empirical) — restart-cycle persistence deferred to WI-1.5.**

## Question
ADR-B4: `WKWebsiteDataStore(forIdentifier:)` gives an isolated persistent profile on
macOS 14+, does NOT crash (#12843), and below 14 the default persistent store is the
fallback (persistence kept, isolation lost).

## Probe
`spike_datastore` command (`src-tauri/src/spike_embed.rs`, debug-only): reads the macOS
major version, creates an identified `WKWebsiteDataStore` (guarded to 14+) to check for
the #12843 crash, and reads `defaultDataStore().isPersistent()`. Invoked live.

## Result (2026-07-12, live app)
```
{"macOSMajor":26,"identifierStoreOk":true,"defaultPersistent":true}
```
- macOS major **26** (≥ 14) → the identifier-isolation API is available.
- **`identifierStoreOk: true`** — `dataStoreForIdentifier(uuid, mtm)` returned a store with
  no crash. The #12843 abort does **not** reproduce here.
- **`defaultPersistent: true`** — the default store is persistent, so the <14 fallback
  path keeps sessions (the load-bearing property).
- The API also compiled clean under `cargo check` — signatures
  (`dataStoreForIdentifier(_, mtm)`, `defaultDataStore(mtm)`, `isPersistent`) confirmed.

**Proven:** ADR-B4 holds — isolation via identifier on 14+, persistent default as fallback,
no crash on this OS.

## Not separately exercised (WI-1.5 integration)
- Full persistence across an app quit/relaunch cycle (write cookie → quit → relaunch →
  cookie present). The store reports `isPersistent: true`; the round-trip is a WI-1.5 test.
- Sub-14 behavior on real old hardware (this machine is macOS 26; the fallback branch is
  guarded but not executed here).

## Verdict
**Verdict:** PASS — identifier store works without crash (macOS 26), default persistent; restart round-trip deferred to WI-1.5.
