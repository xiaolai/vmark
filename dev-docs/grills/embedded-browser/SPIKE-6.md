# SPIKE-6 — Windows + Linux embedding + Windows isolated world

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.6)
> Status: **BLOCKED — requires Windows + Linux hardware (this environment is macOS-only).**

## Question
Because VMark now owns the webview (ADR-B2), the embedding mechanism is platform-specific:
- Windows: parent a `CoreWebView2Controller` to the Tauri window's `HWND`, bound to a rect.
- Linux: add a `WebKitWebView` to the window's GTK container.
- Windows isolated world (I2): `ExecuteScriptInIsolatedWorld` is **absent** from the
  checked `webview2-com` bindings — determine the real path (likely CDP
  `Page.createIsolatedWorld`) or accept the weaker namespaced-global form.
- Linux isolated world: `webkit_web_view_run_javascript_in_world` **exists** (record the
  WebKitGTK floor).

## Why NOT RUN
This machine is **macOS 26 only**. Windows (WebView2) and Linux (webkit2gtk) embedding
cannot be built or observed here — there is no honest way to produce a PASS without the
actual OSes. Faking it would defeat the point of the gate.

## What IS established (reduces this spike's remaining risk)
- The **shared driver trait shape** is validated on macOS (SPIKE-1/2/5 exercise
  create / eval / async-eval / snapshot / embed against a real webview).
- Codex round-2 verified via source that the Windows `HWND`-child path (wry's WebView2
  setup) and the Linux GTK-container path are feasible, and corrected the I2 matrix
  (Linux named worlds exist; Windows needs CDP or the weaker form).

## To run (on the right hardware)
Port the `spike_embed` approach to a Windows and a Linux dev build:
1. `pnpm tauri dev` on each OS.
2. A debug command that creates the platform webview and parents it to the window.
3. Screenshot to confirm rendering; probe the isolated-world availability.

## Verdict
**Verdict:** BLOCKED — needs Windows + Linux machines; cannot be completed in a macOS-only environment. Not a failure; deferred to the correct hardware.
