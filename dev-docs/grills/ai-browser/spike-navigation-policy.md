# AI navigation and redirect policy spike

> Status: **PARTIAL — parser and committed-page policy PASS; live redirect probe pending**

Rust validates the request URL with the AI SSRF policy, clears committed authority at
navigation start, and revalidates the URL reported at top-level commit. Unsafe commits
stop loading, clear one-shots/attachments, and emit a failed event. DNS rebinding remains
a documented WebKit-owned residual limitation.

Evidence:

- `src-tauri/src/browser/ai_policy.test.rs` covers public, private, metadata, alternate
  IPv4, malformed authority, and loopback relaxation cases.
- `src-tauri/src/browser/registry.test.rs` covers ticket and committed-origin revocation.
- A live redirect server probe has not been run against a packaged Tauri window yet.
