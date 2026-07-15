# SPIKE-3 — Screenshot + trusted-input reality check (macOS)

> Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md (WI-0.3)
> Status: **ANSWERED — screenshot PASS; trusted NSEvent input REFUTED (design-consistent).**

## Question
(1) Does `takeSnapshot` capture the embedded webview? (covered by SPIKE-5 — PASS, 14ms.)
(2) Q6: does synthesizing an `NSEvent` mouse click yield **trusted** input
(`event.isTrusted === true`) in an embedded WKWebView, or is trusted input Windows-only?

## Probe
`spike_trusted_input` command (`src-tauri/src/spike_embed.rs`, debug-only): embeds a
webview whose page records `{received, trusted}` on any `click` (capture phase),
synthesizes an `NSEvent` LeftMouseDown+Up at the view centre, and reads the DOM back via
`callAsyncJavaScript`. Two delivery paths tried:
- v1: `NSWindow.sendEvent(_:)` from the background.
- v2: `NSApplication.activateIgnoringOtherApps(true)` + `makeFirstResponder(webview)` +
  `NSApplication.postEvent(_:atStart:)`.

## Result (2026-07-12, live app)
Both paths:
```
{"domResult":{"received":false}}
```
The DOM received **no click at all** — not even an untrusted one. Synthesized `NSEvent`s
(sendEvent and the queue-posted path, with the app activated and the webview first
responder) do not translate into WebKit DOM mouse events here.

**Interpretation (Q6 answered — NO):** trusted native input via `NSEvent` synthesis is
**not readily achievable** on macOS for an embedded WKWebView. WebKit's WebContent
process appears to accept input through the real window-server/HID path, not app-level
`NSEvent` posting. (CGEvent HID-level injection might deliver, but it needs Accessibility
permission and is out of spike scope — and would still not guarantee `isTrusted`.)

**This is design-consistent, not an architecture failure.** Per ADR-B5 the macOS input
tier is **synthetic DOM events** (dispatched via injected JS — `isTrusted:false`, but
works for the large majority of sites), with genuinely-trusted input being a **Windows /
CDP `Input.dispatchMouseEvent`** capability. The plan's platform table already states
"macOS trusted input: unproven"; this spike converts that to "confirmed unavailable via
NSEvent." Updates ADR-B5 and Q6 accordingly.

## Verdict
**Verdict:** REFUTED — trusted NSEvent input does not work on macOS (events not delivered); macOS uses the synthetic tier (ADR-B5), trusted input is Windows/CDP-only. Not blocking.
