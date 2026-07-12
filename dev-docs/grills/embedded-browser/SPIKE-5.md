# SPIKE-5 — Occlusion (freeze-to-snapshot) reality check

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.5)
> Status: **CAPTURE PRIMITIVE PASS (empirical) — full freeze/thaw choreography is WI-1.4.**

## Question
R2's freeze-to-snapshot needs `takeSnapshot` to (a) work on the embedded webview and
(b) be fast enough to hide a native view without a visible stall (target < 100ms), plus
race-free hide/show and IME/focus restoration.

## Probe
`spike_snapshot` command (`src-tauri/src/spike_embed.rs`, debug-only): embeds a webview
filling the content view, lets it paint, then calls
`takeSnapshotWithConfiguration:completionHandler:` (nil config = whole view) and reports
capture latency + image dimensions. Invoked via the automation bridge in the live app.

## Result (2026-07-12, live app)
```
{"ok":true,"latencyMs":14,"imgW":1333,"imgH":1044}
```
- `takeSnapshot` succeeds on a VMark-owned embedded WKWebView.
- **14ms** capture latency — ~7× under the 100ms budget. Freezing to a snapshot before an
  overlay opens is well within a single frame's worth of headroom.
- Full-size image (1333×1044) = the whole content view captured correctly.

**Proven:** the occlusion capture primitive (R2) works and is fast. The native-view-over-
DOM overlay strategy is viable.

## Not separately exercised (WI-1.4 implementation, not spike-level risk)
- Race-free hide/show under rapid overlay open/close (generation counter).
- Focus + IME composition restoration across a freeze/thaw cycle.
- Flicker at 1×/2× DPI and during split-drag resize.

## Verdict
**Verdict:** PASS — capture works at 14ms (< 100ms target); freeze/thaw choreography deferred to WI-1.4.
