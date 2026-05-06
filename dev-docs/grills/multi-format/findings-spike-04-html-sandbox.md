# Phase 0 — WI-0.4 — HTML iframe sandbox spike (Tauri webview)

**Date:** 2026-05-06
**Spike type:** runnable harness + manual verification (Tauri webview required — cannot autonomously launch per AGENTS.md)
**Plan:** `dev-docs/plans/20260506-multi-format-rebrand.md` ADR-4

## Hypothesis

`<iframe sandbox="" srcdoc={content}>` blocks all script execution and resource exfiltration paths inside Tauri's webview, even with strict CSP delivered via `<meta http-equiv>` in the iframe content (CSP `sandbox` directive is not honored via `<meta>` — that's expected; sandbox is enforced by the iframe attribute alone).

## Verification (in two parts)

### Part A — Browser baseline (autonomous)

Open `harness.html` directly in a modern browser (Chrome/Firefox/Safari).

```
cd dev-docs/grills/multi-format/spike-04-html-sandbox
python3 -m http.server 8080
# then open http://localhost:8080/harness.html
```

The harness:
1. Self-tests title-change detection (proves the harness works).
2. Loads 20 OWASP-derived XSS payloads from `payloads.json`.
3. Renders each in a sandboxed iframe.
4. After 1.5s, checks whether `document.title` on the outer page contains any payload's ID.
5. Reports PASS/FAIL per payload and overall.

**Expected result:** all 20 PASS. Title remains `"VMark HTML Sandbox Spike — WI-0.4"`.

### Part B — Tauri webview verification (requires user)

The plan's actual security claim is about Tauri's webview, not a regular browser. Tauri uses WebView2 (Windows), WKWebView (macOS), and WebKitGTK (Linux), each with subtly different sandbox semantics. Per AGENTS.md, this spike cannot launch the Tauri app autonomously.

**Manual test steps for the user:**

1. Build the harness as a temporary VMark page:
   - Add a one-off Tauri command `dev_html_sandbox_spike()` to `src-tauri/src/lib.rs` that returns the harness HTML.
   - Add a one-off React route in dev mode that renders the harness inside the existing Tauri webview.
   - **Do not commit** — this is throwaway.
2. Launch the Tauri app in dev mode (`pnpm tauri:dev`).
3. Open the harness page; observe self-test output, then payload results.
4. **Pass criterion:** "OVERALL: PASS" appears, all 20 payloads PASS, outer document title unchanged.
5. **Fail recovery:** any FAIL = ADR-4 sandbox claim does not hold under Tauri's webview. Phase 3 WI-3.3 (HTML adapter) blocks until the failing payload is mitigated (likely via DOMPurify pre-injection or a stricter CSP).

**What this verifies vs. browser baseline:** identifies any Tauri-webview-specific sandbox escape. Past Tauri CVEs (e.g., CVE-2025-21372 macOS WKWebView) have shown that webview-host bridges can leak; this test confirms the iframe's sandbox attribute holds *inside* the host webview.

## Tauri webview ↔ inner-iframe interaction notes

From inspecting `src-tauri/tauri.conf.json` and Tauri v2 docs:

- **Outer CSP** (`app.security.csp` in tauri.conf.json) governs the host webview only. It does not propagate to the iframe's `srcdoc` content. Confirmed behavior: when a host page sets `Content-Security-Policy: default-src 'self'`, an inner `<iframe srcdoc=…>` runs under its own CSP context unless the parent's CSP `frame-src` blocks it entirely.
- **`<meta http-equiv="Content-Security-Policy">` inside iframe srcdoc** governs resource loading (`img-src`, `style-src`, `script-src`) but does *not* set `sandbox`. CSP `sandbox` is honored only when delivered as an HTTP response header — `srcdoc` content has no HTTP headers, so meta-tag CSP cannot impose sandbox. **The iframe's `sandbox` HTML attribute is therefore the only sandbox enforcement mechanism in this design.** ADR-4 already states this; the spike confirms it must hold.
- **`allow-same-origin` is intentionally absent.** Without it, the iframe document is a unique opaque origin — no `localStorage`, no cookies, no `parent.document` access. This is the strongest sandbox short of `csp` directive `sandbox` (HTTP-only).
- **DOMPurify role:** defense-in-depth. The sandbox is the primary control; DOMPurify is a second layer that strips known-dangerous markup before injection. WI-3.4 decision: include DOMPurify v3.4.2+ (per WI-0.6 — fixes 2025/2026 CVEs).

## Verdict

**Part A (browser baseline): RUNNABLE — execute as documented above.** Spike code is in `dev-docs/grills/multi-format/spike-04-html-sandbox/`. Expected result is all PASS, but actual outcome depends on running the harness.

**Part B (Tauri webview): BLOCKING ON USER.** Cannot run autonomously per AGENTS.md. The plan's WI-3.4 security review checkpoint already requires manual sign-off; this Phase 0 spike's Part B is the prerequisite for that sign-off.

**Recommendation:** Phase 1A may proceed without Part B's result (Phase 1A doesn't ship HTML support — that's Phase 3). Phase 3 cannot proceed without Part B.

## Disposition

This spike directory (`dev-docs/grills/multi-format/spike-04-html-sandbox/`) is **deleted before Phase 1A** per ADR-11. Phase 3 WI-3.3 / WI-3.4 will recreate the harness inside the actual `<HtmlSandboxPreview>` component test suite — at that point the test moves from grills (throwaway) to `src/components/Editor/HtmlSandboxPreview/__tests__/sandbox.test.ts` (production).

## OWASP payload sources

Payloads `P01`–`P20` cover:

- Inline scripts (P01, P03, P08)
- Event handlers (P02, P03)
- URI schemes (P04 javascript:, P05 data:)
- Network exfil (P06 external script, P07 external img, P17 @import)
- Forms (P09)
- Nested-iframe sandbox-escalation attempt (P10)
- Popups / navigation hijack (P11, P12, P15)
- CSS injection (P13)
- DOM clobbering (P14)
- Embed/object (P16)
- SVG (P08, P18)
- MathML (P19)
- Mutation XSS (P20)

Derived from OWASP XSS Filter Evasion Cheat Sheet and Mario Heiderich's HTML5 Security Cheatsheet patterns. Not exhaustive — Phase 3 WI-3.4 sign-off should add any payload classes not covered here based on the user's threat model.
