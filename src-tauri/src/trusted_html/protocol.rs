//! The `vmark-trusted://` URI scheme.
//!
//! Purpose: give an authorized HTML document an ORIGIN OF ITS OWN, so it
//! arrives with its own `Content-Security-Policy` response header instead of
//! inheriting the app's.
//!
//! Why a scheme at all, rather than a longer `sandbox` allow-list on the
//! existing `srcdoc` frame: a `srcdoc`, `blob:` or `data:` document inherits
//! the embedder's policy container, and VMark's app CSP is `script-src 'self'`.
//! A `<meta>` CSP inside the frame can only further restrict an inherited
//! policy, never relax it, so no attribute on the iframe can make an inline
//! script run. Measured in WebKit before this module was written: `srcdoc` and
//! `blob:` both fail with "Refused to execute a script…", and `data:` is
//! refused a step earlier by the app's `default-src 'self'` acting as
//! `frame-src`.
//!
//! What defends the IPC boundary, stated precisely because an earlier version
//! of this note overstated it (all of the below measured in the running app
//! against tauri 2.11.5, not inferred):
//!
//! - **`window.webkit.messageHandlers` IS reachable from the sandboxed frame.**
//!   WKWebView exposes handlers per-webview, so the opaque-origin child can
//!   see and post to them. The frame's own CSP (`default-src 'none'`, no
//!   `connect-src`) blocks the custom-protocol `fetch` path, so this is its
//!   ONLY channel — but it is a real one.
//!
//! - **`__TAURI_INVOKE_KEY__` is what stops it, and it is the ONLY thing that
//!   does.** The invoke bootstrap is injected `for_main_frame_only: true`
//!   (`manager/webview.rs`), so the frame never receives the key and
//!   `Webview::on_message` refuses its message before deserialization
//!   (`missing field __TAURI_INVOKE_KEY__`). Measured both ways: without the
//!   key the command does not run; with a key lifted from the main frame and
//!   pasted into the document, a real command **executed** from inside the
//!   sandboxed frame.
//!
//! - **There is NO second layer from the ACL, contrary to what this note used
//!   to claim.** `Webview::is_local_url` counts any scheme in
//!   `uri_scheme_protocols` as local — and registering `vmark-trusted` is
//!   exactly what puts it there. The frame therefore resolves to
//!   `Origin::Local` and would receive the app's full capability set. The
//!   "remote origin has no capability" argument applies to `http(s)` origins,
//!   not to this one.
//!
//! Why that is nonetheless sound: the frame cannot obtain the key. It has no
//! init script, it cannot read the cross-origin parent (both measured), the
//! key is per-run and ~20 characters of mixed printable ASCII, and the IPC
//! response is delivered to the main frame's `runCallback` — so a guessing
//! frame gets no oracle telling it whether a guess was right.
//!
//! What that costs: the property rests on ONE Tauri internal
//! (`for_main_frame_only` on the bootstrap) plus the key check, neither of
//! which is documented API. `tauri_pin.test.rs` fails if the tauri version
//! moves off the one this was verified against, so a bump forces
//! re-verification rather than silently removing the only layer.
//!
//! **Same-origin escape** is a separate matter and is closed by construction:
//! the host mounts the frame with `sandbox="allow-scripts"` and no
//! `allow-same-origin`, so the document is opaque-origin — it cannot read
//! `parent.document`, cannot reach the app's globals, and cannot rewrite its
//! own `sandbox` attribute. That is also what keeps the invoke key out of its
//! reach, so the two are related: the sandbox protects the secret, and the
//! secret protects the IPC.
//!
//! This module owns the remaining leg: nothing is servable that the user did
//! not explicitly authorize, and what is served is locked down by response
//! header.
//!
//! @coordinates-with state.rs — the grant registry this reads
//! @coordinates-with ../../../src/lib/formats/adapters/htmlTrust.ts — builds the frame URL

use tauri::http::{Request, Response};

use super::state::TrustedHtmlState;

/// The scheme registered on the Tauri builder. Also named in the app CSP's
/// `frame-src` (`tauri.conf.json`) — the app cannot embed what its own policy
/// does not allow.
pub const SCHEME: &str = "vmark-trusted";

/// The response policy for a trusted document.
///
/// `default-src 'none'` with no `connect-src` is what keeps requirement 9
/// (no network) true: `fetch`, `XMLHttpRequest`, `WebSocket` and
/// `EventSource` all fall back to `default-src`. `blob:` appears only for
/// `img-src`/`media-src` because a canvas-driven document legitimately renders
/// its own frames that way, and a blob URL minted inside an opaque origin
/// cannot name anything outside it.
///
/// `'unsafe-eval'` is deliberately absent — minimum capability (requirement 7).
///
/// **No `frame-ancestors`.** It was here, set to `'self'`, and it BROKE THE
/// FEATURE: `'self'` is the origin of the framed document (`vmark-trusted://`),
/// while the embedder is the app origin, so the trusted iframe was refused
/// before it ever loaded. Verified in WebKit — a document served with
/// `frame-ancestors 'self'` and embedded cross-origin logs "Refused to load …
/// because it does not appear in the frame-ancestors directive".
///
/// The directive bought nothing here even when spelled correctly: what stops a
/// hostile page embedding a trusted document is that the URL contains 32 bytes
/// of CSPRNG entropy and the scheme is only reachable inside this process.
/// Isolation is carried by the opaque-origin sandbox, not by this.
const CSP: &str = "default-src 'none'; \
script-src 'unsafe-inline'; \
style-src 'unsafe-inline'; \
img-src data: blob:; \
media-src data: blob:; \
font-src data:; \
base-uri 'none'; \
form-action 'none'";

/// Token shape: the app's standard 64-char hex secret.
const TOKEN_LEN: usize = 64;

/// The live handler, wired in `lib.rs`.
pub fn handle(state: &TrustedHtmlState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    respond(state, &request.uri().to_string())
}

/// The response for a request that cannot be resolved at all — used when the
/// registry is not managed, which should be impossible (`.manage()` and
/// `.register_uri_scheme_protocol()` are adjacent in the same builder chain).
///
/// It exists so that impossibility costs a 404 rather than a panic: this runs
/// on the webview's protocol thread, where unwinding takes the app down for
/// what is, at worst, a preview that fails to load.
pub fn refuse() -> Response<Vec<u8>> {
    build(404, Vec::new())
}

/// Testable core: resolve `uri` against the registry and build the response.
fn respond(state: &TrustedHtmlState, uri: &str) -> Response<Vec<u8>> {
    match token_of(uri).and_then(|t| state.html(&t)) {
        Some(html) => build(200, html.into_bytes()),
        None => build(404, Vec::new()),
    }
}

/// The token named by `uri`, if it names exactly one well-formed token.
///
/// Deliberately strict: the token is the ONLY selector this scheme honours, so
/// a trailing path segment is a refusal rather than something to ignore. That
/// is what stops the scheme from ever growing into a file-read primitive.
fn token_of(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix(&format!("{SCHEME}://"))?;
    // `host/path` — drop the host, then the query/fragment.
    let path = rest.split_once('/')?.1;
    let path = path.split(['?', '#']).next().unwrap_or("");
    if path.len() != TOKEN_LEN || !path.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(path.to_string())
}

/// Every response — hit or refusal — carries the same restrictive headers. A
/// refusal is still a document the webview parses.
fn build(status: u16, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Cache-Control", "no-store")
        .body(body)
        // Infallible: every header value above is a static ASCII literal.
        .expect("trusted-html response headers are always valid")
}

#[cfg(test)]
#[path = "protocol.test.rs"]
mod tests;
