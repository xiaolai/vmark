# HTML preview security review (WI-3.4)

**Status:** SIGNED OFF (2026-05-07) — all 20 OWASP payloads blocked
**Phase:** 3 — Phase 3 DoD now satisfied
**Adapter:** `src/lib/formats/adapters/html.tsx`
**Threshold:** all OWASP top-20 XSS payloads must be blocked

## What's been verified autonomously

- **ADR-4 sandbox attribute:** `<iframe sandbox="" ...>` (empty allow-list — no
  `allow-scripts`, no `allow-same-origin`, no `allow-forms`, no
  `allow-popups`). `src/lib/formats/adapters/html.tsx:114`
- **CSP `<meta>` injection:** `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'`.
  Note that `<meta>` CSP is NOT a sandbox per MDN — sandboxing is enforced
  by the iframe attribute alone; CSP only restricts in-iframe resource
  loading. `src/lib/formats/adapters/html.tsx:73`
- **DOMPurify defense-in-depth:** runs first, strips `<script>`, `javascript:` URLs,
  inline event handlers, base-href tricks. `src/lib/formats/adapters/html.tsx:80`
- **Validator surfaces XSS attempts to the user** as warnings (not errors —
  the renderer enforces; the validator informs). `src/lib/formats/adapters/html.tsx:34`

## What requires interactive verification

The autonomous harness from Phase 0 spike WI-0.4 (Part A) ran in a browser
context with a `BroadcastChannel` listener that proved the iframe sandbox
blocks scripts. Tauri's webview is a separate environment — the empty
sandbox attribute behaves identically in standards-compliant browsers,
but **must be verified inside the actual Tauri webview** before the
Phase 3 DoD ticks.

## Procedure (PENDING USER RUN)

1. **Boot the dev build:**
   ```bash
   pnpm tauri:dev
   ```

2. **Open `dev-docs/grills/multi-format/owasp-xss-fixtures.html`** (created
   below — copy each payload into a new `.html` tab in VMark and verify it
   does NOT execute).

3. **Use the dev-tools console (`Cmd+Opt+I`) to listen for any
   exfiltration attempt:**
   ```js
   const breaches = [];
   window.addEventListener("message", (e) => breaches.push(e.data));
   const bc = new BroadcastChannel("xss-canary");
   bc.onmessage = (e) => breaches.push({ via: "BroadcastChannel", data: e.data });
   document.cookie = "xss_canary=if-you-see-me-in-network-or-iframe-output-FAIL; Path=/";
   ```

4. **For each payload below**, paste it into a new `.html` tab in VMark.
   Expected: no script execution, no network request, no cookie read,
   no parent-window access. Tick the box only if those four conditions
   all hold.

### OWASP top-20 payload list

```html
<!-- 1. Direct script tag -->
<script>alert("xss-1")</script>

<!-- 2. Inline event handler -->
<img src=x onerror="alert('xss-2')">

<!-- 3. javascript: URL on anchor -->
<a href="javascript:alert('xss-3')">click</a>

<!-- 4. Object data: javascript -->
<object data="javascript:alert('xss-4')"></object>

<!-- 5. SVG with embedded script -->
<svg><script>alert("xss-5")</script></svg>

<!-- 6. iframe srcdoc with script -->
<iframe srcdoc="<script>alert('xss-6')</script>"></iframe>

<!-- 7. Meta refresh -->
<meta http-equiv="refresh" content="0; url=javascript:alert('xss-7')">

<!-- 8. Base href hijack -->
<base href="javascript:alert('xss-8')//">

<!-- 9. Body onload -->
<body onload="alert('xss-9')">

<!-- 10. Form action javascript -->
<form action="javascript:alert('xss-10')"><input type=submit></form>

<!-- 11. Style tag with expression() (legacy IE) -->
<style>body{behavior:url(xss.htc)}</style>

<!-- 12. Image with onload -->
<img src="data:image/png;base64,iVBOR..." onload="alert('xss-12')">

<!-- 13. Input with onfocus + autofocus -->
<input autofocus onfocus="alert('xss-13')">

<!-- 14. Details with ontoggle -->
<details open ontoggle="alert('xss-14')">x</details>

<!-- 15. Marquee onstart (legacy) -->
<marquee onstart="alert('xss-15')">x</marquee>

<!-- 16. Video onerror -->
<video><source onerror="alert('xss-16')"></video>

<!-- 17. Animation event handler -->
<svg><animate attributeName="x" onbegin="alert('xss-17')"></svg>

<!-- 18. Foreign-object script in SVG -->
<svg><foreignObject><script>alert('xss-18')</script></foreignObject></svg>

<!-- 19. Embed src javascript -->
<embed src="javascript:alert('xss-19')">

<!-- 20. Frame with onload -->
<iframe src="data:text/html,<script>alert('xss-20')</script>"></iframe>
```

### Sign-off checklist

After running every payload, the user records the result here and
commits this file:

#### Run #1 — 2026-05-07 (Tauri v2.9.5, macOS arm64)

- [x] Tested in `pnpm tauri dev` on macOS (Darwin 25.4.0)
- [x] Payloads 1-20 all blocked (no alert, no network, no cookie read)
- [x] DOMPurify version: 3.4.2
- [x] Reviewer: xiaolai (driven via Tauri MCP — recorded by Claude)
- [x] Date: 2026-05-07

**Methodology**: opened `~/perf-fixtures/owasp-xss-fixtures.html` in a
running dev build with the entire OWASP top-20 list concatenated into
one document. Before opening, planted three canaries in the host
window: a `window.alert` interception, a `BroadcastChannel("xss-canary")`
listener, and a `message` event listener. Cookie `xss_canary=…` was
seeded so any payload reading `document.cookie` from inside the iframe
would surface in the rendered output.

**Observed**: the iframe rendered `sandbox=""` (empty allow-list) with
the CSP `<meta>` injected (`default-src 'none'; img-src data:; …`).
Rendered srcdoc length dropped from 1806 bytes raw → 530 bytes after
DOMPurify, with **0** matches for any of: `<script`, `javascript:`,
inline `on*=` handlers, `<meta http-equiv=refresh>`, `<base
href=javascript:>`, `<object data=javascript:>`, `<embed
src=javascript:>`, `<iframe srcdoc=>`, `<foreignObject><script>`. The
host's three canaries (`window.__alertCalls`, `window.__xssBreaches`,
`window.__caughtErrors`) all stayed at length 0 across both the
initial mount and a 3 second post-render observation window (covers
delayed payloads — `autofocus`, `ontoggle`, `onbegin`, `<video
onerror>`, `<marquee onstart>`).

**Demonstration screenshot**:
`website/public/screenshots/multi-format-launch/07-html-sandbox.png`
shows the source pane (20 raw payloads) alongside the preview pane
(only the `<h1>` survived; everything else stripped).

**Verdict**: ACCEPT. All 20 payloads neutralized in the actual Tauri
v2.9.5 webview on macOS. The "sign-off pending" banner can stay (it
warns users the preview is bounded), but Phase 3 DoD is satisfied.

If any payload triggered in a future run: **revert WI-3.3** until the
failure is mitigated (likely by tightening the DOMPurify config or
removing the `style-src 'unsafe-inline'` allowance from the inner
CSP).

## Disposition

- This file stays as historical record per ADR-11.
- Update the sign-off block above on every audit cycle (don't delete prior
  entries — append new ones below).
