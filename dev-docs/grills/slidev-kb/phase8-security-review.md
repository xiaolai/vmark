# Phase 8 WI-8.3 — Security review (content server)

> Date: 2026-06-25 · Scope: `vmark-content-server/` (auth, routes, render,
> search), `src-tauri/src/content_server/` (provisioning), `src/services/
> contentServer`, `src/stores/contentServerStore`.

## Summary

- **Findings:** 1 Medium, 2 Needs-verification (defense-in-depth). No
  Critical/High.
- **Confidence:** High on the reviewed surface; the spawn/Chromium paths are
  not yet wired (external residue) and out of scope here.

## Findings

### [VULN-001] Reusable bootstrap token exposed in URL (Medium)

- **Location:** `vmark-content-server/src/server/auth.ts` (`handleBootstrap`).
- **Issue:** The `/__auth?t=<token>` bootstrap token is the persistent
  port-file token and is accepted on every call, and it travels in the URL
  (browser history / referrer exposure). Threat-model T2 calls for a
  single-use / short-TTL bootstrap token; not yet implemented.
- **Impact:** Low-to-moderate, loopback-only: a local actor who can read the
  user's browser history could replay the bootstrap to obtain a session cookie
  for the (still loopback-bound, token-gated) server. Not remotely reachable.
- **Fix (Phase 4 hardening, tracked):** issue a one-time nonce for `/__auth`
  (mint per "open in browser", invalidate on first use, short TTL), distinct
  from the long-lived port-file token; strip the query param after redirect.

## Needs verification (defense-in-depth, not high-confidence vulns)

### [VERIFY-001] iframe sandbox flags
- **Location:** `src/components/KnowledgeBasePanel/KnowledgeBasePanel.tsx`.
- **Note:** `sandbox="allow-scripts allow-same-origin"` is acceptable because
  the framed origin (loopback server) differs from the Tauri app origin, so the
  framed content cannot remove the parent's sandbox. Revisit if the panel ever
  frames same-origin content. CSP `frame-ancestors 'none'` (S0.6) further limits
  embedding.

### [VERIFY-002] Double-decode on note path
- **Location:** `createServer.ts` `containedAbsPath`.
- **Note:** Explicit `decodeURIComponent` plus Hono's own path handling. Even
  if a layer double-decodes, `path.resolve` + `startsWith(root + sep)` rejects
  any escape (verified by test). No action required; documented for awareness.

## Confirmed-safe (researched, not flagged)

- Path traversal: contained (resolve + prefix check; symlinks skipped in walker).
- Stored XSS: DOMPurify-on-jsdom; script/handler/iframe stripped; `javascript:`
  hrefs removed; XSS corpus passes in Node.
- Search: no regex on user query → no ReDoS.
- Provisioning: checksum-before-extract; atomic same-FS swap with restore.
- Token at rest: port-file written mode 0600.
- CSRF: GET routes side-effect-free; cookie SameSite=Strict; export is POST
  (Phase 7).
