# SPIKE-2 — Sync + async eval, init scripts, dependency matrix (macOS)

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.2)
> Status: **ASYNC-EVAL PASS (empirical) — cross-platform matrix + init-script parts pending.**

## Question
1. `evaluateJavaScript` returns a value from a page to Rust (sync eval).
2. **`callAsyncJavaScript` AWAITS a real Promise and returns the resolved value** — the
   primitive publishing depends on; plain `evaluateJavaScript` cannot await a Promise
   (ADR-B3). Its floor is macOS 11+.
3. A `WKUserScript` at `atDocumentStart` runs on every navigation in an isolated world.
4. A target-specific dependency matrix (macOS/Windows/Linux) that COMPILES.

## Probe
Shares `spike1-probe/` (see SPIKE-1). After the no-bridge check it runs, in
`WKContentWorld.pageWorld()`:
`return await new Promise((res) => setTimeout(() => res(42), 10));`
via `callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:`.

## Result (2026-07-12, this machine)
```
[spike1] PASS (SPIKE-2) — callAsyncJavaScript awaited a Promise → 42 (async eval works).
```

**Proven empirically:**
- `callAsyncJavaScript` awaits a Promise and returns the resolved value (42). ADR-B3's
  load-bearing async primitive works — the publishing pillar is de-risked on macOS.
- Sync `evaluateJavaScript` returns a value (the no-bridge JSON string, SPIKE-1).
- The **macOS dependency matrix compiles**: objc2 0.6.4, objc2-foundation/app-kit/web-kit
  0.3.2 (features `WKWebView`, `WKWebViewConfiguration`, `WKContentWorld`, `WKFrameInfo`,
  `block2`), block2 0.6.2, objc2-core-foundation 0.3.2. See `spike1-probe/Cargo.toml`.

**Still NOT run:**
- `WKUserScript` @ documentStart injection on every navigation in an isolated world
  (needs a multi-navigation test; the API is present).
- Windows (`webview2-com`) and Linux (`webkit2gtk`) dependency matrices + cross-compile
  (`pnpm check:cross`) — owned by WI-0.6.
- The macOS floor decision (callAsyncJavaScript is macOS 11+, app min is 10.15 — Q7).

### Follow-up (SPIKE-7 probe): real in-page `fetch()` awaited via `callAsyncJavaScript`
The SPIKE-7 probe later confirmed `callAsyncJavaScript` awaits a **real network `fetch()`**
(not just a `setTimeout` Promise) and returns its parsed result — closing any doubt that
the async primitive works for actual HTTP, not only trivial Promises.

## Verdict
**Verdict:** PASS — sync + async eval (incl. real fetch) and the macOS dependency matrix confirmed empirically. Windows/Linux matrices + `WKUserScript` init-script are SPIKE-6 / WI-2.2.
