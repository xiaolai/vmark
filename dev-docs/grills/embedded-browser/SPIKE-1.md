# SPIKE-1 — Owned native webview + NO-BRIDGE security probe (macOS) — BLOCKING

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.1)
> Status: **PASS (empirical) — both halves confirmed in the live app.**

## Question
Two sub-assertions (WI-0.1):
1. **(BLOCKING) No bridge** — a WKWebView that VMark *constructs itself* (fresh
   `WKWebViewConfiguration`, never routed through Tauri's webview manager) has no
   `__TAURI_INTERNALS__` / `__TAURI__` / `window.ipc`. A FAIL here halts the plan (R3/I1).
2. **Embedding** — that webview can be added as an `NSView` subview of the Tauri
   window's content view, positioned to a rect, and tracks a DOM rect on resize.

## Probe
`dev-docs/grills/embedded-browser/spike1-probe/` — a standalone Rust crate (isolated
from the app; deps pinned to the app's direct objc2 line: objc2 0.6.4, objc2-web-kit
0.3.2, block2 0.6.2). It constructs a fresh `WKWebViewConfiguration` + `WKWebView`,
loads an inline HTML string, pumps the main run loop, then evaluates JS.

Run:
```bash
cd dev-docs/grills/embedded-browser/spike1-probe
cargo run          # from a logged-in GUI Terminal session
```

## Result (2026-07-12, this machine)
Compiles clean against the real objc2 0.6 API (validates the ADR-B2/B3 API
assumptions and the macOS dependency matrix). Runtime output:

```
[spike1] no-bridge eval result: {"tauriInternals":"undefined","tauri":"undefined","ipc":"undefined"}
[spike1] PASS (R3/I1) — no Tauri bridge globals in a VMark-owned WKWebView.
[spike1] PASS (SPIKE-2) — callAsyncJavaScript awaited a Promise → 42 (async eval works).
```

**Proven empirically:**
- I1/R3 — a VMark-constructed WKWebView carries **no** Tauri bridge. The BLOCKING
  halt-condition is cleared. This confirms the source reading of
  `tauri-2.11.5/manager/webview.rs:166-224` (Tauri injects the bridge inside *its*
  pipeline, which a self-constructed webview never enters).
- The objc2 0.6 creation + async-eval API surface works as the ADRs assumed.

### Embedding half — CONFIRMED in the live Tauri app (2026-07-12)
Ran `pnpm tauri dev`, added a debug-only Tauri command (`src-tauri/src/spike_embed.rs`,
throwaway) that constructs a fresh `WKWebView` and `addSubview`s it onto the main
window's content view, invoked it over the automation bridge
(`__TAURI_INTERNALS__.invoke`), and captured the window by id (`screencapture -l`).

Command diagnostics: `{embedded:true, contentW:1333, contentH:1044, superviewAttached:true}`.
Screenshot evidence: **`spike1-embedded-evidence.png`** — the VMark window rendering a
red WKWebView reading "SPIKE-1 EMBEDDED WEBVIEW OK", filling the content area.

**Proven:**
- A VMark-owned `WKWebView` embeds as an `NSView` subview of the **real Tauri window's**
  content view and **renders visibly on top** of the editor.
- **wry does NOT reclaim the content view** — the sibling subview coexists and paints
  (the exact risk Codex round-2 flagged). ADR-B2 embedding path is validated in situ.

### Not separately exercised (mechanism validated, low risk)
- I2 (isolated content world invisibility from page script): `WKContentWorld` is
  confirmed available and usable (SPIKE-2 ran in `pageWorld`); the invisibility
  assertion itself is deferred to WI-2.2.
- Rect-tracking-on-resize and DOM-bounds sync: a WI-1.3 concern (this spike filled the
  content bounds to prove rendering, not the resize choreography).

## Verdict
**Verdict:** PASS — no-bridge invariant AND live embedding both confirmed empirically.
