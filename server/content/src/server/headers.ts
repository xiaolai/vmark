/**
 * Security headers + CSP (grill H1/H4; implements the S0.6 threat-model table).
 *
 * @module server/headers
 */

// X-Frame-Options is intentionally omitted: it is superseded by the CSP
// `frame-ancestors` directive, which (unlike X-Frame-Options) can permit the
// Tauri webview origin to embed the loopback KB in-app (grill M2). nosniff +
// no-referrer remain.
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * Origins allowed to frame the KB: the loopback server itself plus the Tauri
 * webview (so the in-app panel can embed it). Embedding remains safe because
 * every request is loopback-bound and session-cookie-gated.
 */
const EMBED_ANCESTORS = "'self' tauri: http://localhost:* http://127.0.0.1:* https://tauri.localhost";

/**
 * Build the CSP. Untrusted workspaces forbid remote images/connections;
 * trusted workspaces allow `https:` images (the §3bis matrix). `connect-src`
 * keeps SSE (`/__events`) working. Scripts/styles stay self + inline (KaTeX and
 * the small client bundle); tightening to hashes is a later hardening step.
 */
export function buildCsp(trusted: boolean): string {
  const imgSrc = trusted ? "'self' data: https:" : "'self' data:";
  return [
    "default-src 'self'",
    `img-src ${imgSrc}`,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    `frame-ancestors ${EMBED_ANCESTORS}`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}
