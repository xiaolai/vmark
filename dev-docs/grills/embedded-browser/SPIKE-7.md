# SPIKE-7 — Publishing probe + CSRF/session reality

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.7)
> Status: **MECHANISM PASS (empirical) — real-platform draft creation needs a target.**

## Question
ADR-S4's publishing mechanism: can an **in-page `fetch()` with `credentials:'include'`**,
executed inside a VMark-owned embedded webview and awaited from Rust, **carry the user's
session cookie** to the platform's own web API? (Plus: CSRF acquisition, auth expiry,
binary upload — the platform-specific half.)

## Probe
`spike_fetch` command (`src-tauri/src/spike_embed.rs`, debug-only): embeds a webview,
navigates it to a real remote origin that sets a cookie
(`https://httpbin.org/cookies/set/spikeauth/ok123` → redirects to `/cookies`), then runs
via `callAsyncJavaScript` in `pageWorld`:
```js
const r = await fetch('/cookies', {credentials:'include'});  // relative ⇒ same-origin
const j = await r.json();
```

## Result (2026-07-12, live app)
```json
{"ok":true,"href":"https://httpbin.org/cookies","cookies":{"spikeauth":"ok123"}}
```
**Proven end-to-end:**
1. The embedded webview performs a **real remote navigation** (not just `loadHTMLString`).
2. The server-set **session cookie persists** in the webview's data store.
3. An **in-page credentialed `fetch()`** runs, is **awaited from Rust** via
   `callAsyncJavaScript`, and **carries the cookie** — the server echoed it back.

This is precisely ADR-S4's mechanism (the Wechatsync approach): call the platform's own
web API from inside a page that already holds the user's session. **The mechanism works.**

### Gotcha found (worth keeping)
A first attempt fetched the **absolute** cross-origin URL and failed with
`TypeError: Load failed`. Reason: httpbin sends `Access-Control-Allow-Origin: *`, and
browsers **reject a wildcard CORS origin when `credentials:'include'` is used**. Publishing
adapters must therefore issue **same-origin** requests (relative URLs) from a page already
on the platform's origin — which is exactly what the design calls for, but it is an easy
way to get a confusing failure. Recorded for WI-3.4.

## Real-platform interactive browser (2026-07-12)
`spike_open_browser("https://x.com/login")` embedded a **persistent-profile** webview
(fixed `WKWebsiteDataStore` identifier, ADR-B4) and navigated to X/Twitter. The full X
SPA rendered correctly and the **interactive login flow works end to end** — the user
typed credentials directly into the embedded webview (real HID input; consistent with
SPIKE-3, where only *synthesized* input failed) and X advanced to email-code
verification. Confirms: a VMark-owned embedded webview is a **real, usable browser** for a
complex commercial SPA, with a persistent session. `spike_session_check` (read-only)
validates that the login carries across webviews on the same profile — run after login.

## Not exercised (needs completed login / a self-hosted target)
- Creating an actual **draft** on a platform (WI-0.7's literal acceptance).
- **CSRF/nonce acquisition**, auth-expiry detection, binary image upload.
- Legal/TOS + account-safety review (plan restricts the real probe to a **self-hosted**
  WordPress target — none provisioned here).

## Verdict
**Verdict:** PARTIAL — ADR-S4's credentialed same-origin fetch mechanism PASSES empirically; real draft creation + CSRF still need a self-hosted target.
