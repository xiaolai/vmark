//! One authenticated loopback client per observed content-server generation.
//!
//! Purpose: everything a command needs to TALK to a running content server,
//! in one place — the manager read that pairs port with token under ONE lock
//! (#128), the bounded `reqwest` client (#130), the bearer header, the
//! status-before-body refusal (#131) and the nonce mint — so `http.rs` and
//! `slidev_commands.rs` no longer carry their own copies, which had already
//! drifted (#129): one mint checked the status before decoding and the other
//! did not; one client was bounded and the other was `Client::new()`.
//!
//! The client never follows a redirect. No API call answers with one, and
//! `/__auth`'s 302 IS the answer: its `Location` carries the session token
//! that `content_server_graph` reads.
//!
//! @coordinates-with manager.rs — `server_and_token`, the one-lock read
//! @coordinates-with http.rs — browser URL + graph over this client
//! @coordinates-with slidev_commands.rs — preview + export over this client
//! @module content_server/client

use std::time::{Duration, Instant};

use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::Deserialize;

use crate::command_error::{CommandError, ErrorCode};

use super::ContentServerManager;

/// Connection establishment: loopback, so anything longer is a wedged server.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// A running server's loopback base URL and bootstrap token, and the bounded
/// client that talks to it.
pub(super) struct ServerClient {
    base: String,
    token: String,
    http: Client,
    /// When this client's whole conversation must be over (#310).
    deadline: Instant,
}

impl ServerClient {
    /// The client for the server registered for `workspace_root` — port and
    /// token from ONE manager read (#128) — or `not-found` when none runs.
    /// `total` bounds the whole conversation, not each request (#130, #310).
    pub(super) fn connect(
        mgr: &ContentServerManager,
        workspace_root: &str,
        total: Duration,
    ) -> Result<Self, CommandError> {
        let (server, token) = mgr
            .server_and_token(workspace_root)
            .ok_or_else(|| CommandError::not_found("content server not running"))?;
        Self::new(format!("http://127.0.0.1:{}", server.port), token, total)
    }

    /// A client for an explicit base URL — what tests point at a mock server.
    ///
    /// `total` is the deadline for EVERYTHING this client goes on to do, not a
    /// per-request allowance (#310). Every caller here makes more than one
    /// request — `preview_url` posts and then mints, `graph_over` mints,
    /// authenticates and fetches — so a per-request bound let a command run for
    /// a multiple of the number the constant names: `content_server_slidev_preview`
    /// advertised 120 s and could take nearly 240. The reqwest client keeps
    /// `total` as a ceiling for any single request; `send` narrows each one to
    /// what is LEFT.
    pub(super) fn new(base: String, token: String, total: Duration) -> Result<Self, CommandError> {
        let http = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(total)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| CommandError::internal(format!("could not build HTTP client: {e}")))?;
        Ok(Self {
            base,
            token,
            http,
            deadline: Instant::now() + total,
        })
    }

    /// The `/__auth?t=` PATH that trades `nonce` for a session cookie, landing
    /// on `next` (a same-origin path) or the site root.
    ///
    /// One construction, two consumers (#286): [`Self::auth_url`] hands the
    /// absolute URL to the webview, and `http::graph_over` sends this path
    /// itself. They were built separately, so the endpoint, the parameter name
    /// and the `next` spelling each lived in two places and only one of them
    /// would be found by a rename.
    pub(super) fn auth_path(&self, nonce: &str, next: Option<&str>) -> String {
        match next {
            Some(next) => format!("/__auth?t={nonce}&next={next}"),
            None => format!("/__auth?t={nonce}"),
        }
    }

    /// The absolute `/__auth?t=` URL a webview can navigate to.
    pub(super) fn auth_url(&self, nonce: &str, next: Option<&str>) -> String {
        self.url(&self.auth_path(nonce, next))
    }

    /// `GET path`, with the bootstrap token as bearer.
    pub(super) fn get(&self, path: &str) -> RequestBuilder {
        self.http.get(self.url(path)).bearer_auth(&self.token)
    }

    /// `GET path` with no credential — for the session-in-query calls
    /// (`/__auth?t=`, `/api/graph?s=`), which must not see the bootstrap token.
    pub(super) fn get_anonymous(&self, path: &str) -> RequestBuilder {
        self.http.get(self.url(path))
    }

    /// `POST path` with a JSON body, with the bootstrap token as bearer.
    pub(super) fn post_json(&self, path: &str, body: &serde_json::Value) -> RequestBuilder {
        self.http
            .post(self.url(path))
            .bearer_auth(&self.token)
            .json(body)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// Send `req`, classing a request that got no answer: `timeout` when the
    /// bound elapsed (#130), `network` for anything else the transport
    /// reports. The status is the caller's to judge — `/__auth` answers 302.
    pub(super) async fn send(
        &self,
        what: &str,
        req: RequestBuilder,
    ) -> Result<Response, CommandError> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            // Refused BEFORE the request goes out: a zero timeout handed to
            // reqwest is a request that is sent and then abandoned, and the
            // server would run a preview or an export nobody is waiting for.
            return Err(CommandError::timeout(format!(
                "{what} was not attempted: the content-server request budget was already spent"
            )));
        }
        req.timeout(remaining)
            .send()
            .await
            .map_err(|e| transport_failure(what, e))
    }

    /// `send`, and require a 2xx answer. Anything else is a `refusal`, with
    /// the status read BEFORE the body (#131) so an error document is
    /// reported as the refusal it is, not as a decoding failure.
    pub(super) async fn send_ok(
        &self,
        what: &str,
        req: RequestBuilder,
    ) -> Result<Response, CommandError> {
        let resp = self.send(what, req).await?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let body = error_body(resp).await;
        Err(refusal(what, status, &body))
    }

    /// Mint a single-use nonce (`GET /__mint`) for the `/__auth` handshake.
    pub(super) async fn mint_nonce(&self) -> Result<String, CommandError> {
        #[derive(Deserialize)]
        struct Mint {
            nonce: String,
        }
        let mint: Mint = self
            .send_ok("nonce mint", self.get("/__mint"))
            .await?
            .json()
            .await
            .map_err(|e| body_failure("nonce mint", e))?;
        // An EMPTY nonce is not a nonce (#275). It deserializes fine, so it
        // used to travel on: `auth_url` handed the webview `/__auth?t=`, and
        // `graph_over` sent it and reported the server's inevitable refusal as
        // an authentication failure — a diagnosis pointing at the handshake
        // when the mint is what broke. `internal` is the class this module
        // already gives a contract break with VMark's own server.
        if mint.nonce.trim().is_empty() {
            return Err(CommandError::internal("nonce mint returned an empty nonce"));
        }
        Ok(mint.nonce)
    }
}

/// Most bytes of a REFUSED response's body kept for the message (#273).
///
/// The server's own error documents are a line of JSON. A body read whole
/// travels into a `CommandError` message, the log and the frontend, so a
/// broken loopback server answering with megabytes would be allocated,
/// serialised across IPC and rendered. What a reader needs is the first line.
const MAX_ERROR_BODY: usize = 2 * 1024;

/// The head of a refused response's body, as text. Read in CHUNKS and stopped
/// at `MAX_ERROR_BODY` rather than with `text()`, which buffers whatever the
/// server sends; the bound holds within one transport chunk of exact.
/// A body that cannot be read at all is empty — the STATUS is the refusal,
/// and `refusal` already says so without one.
pub(super) async fn error_body(mut resp: Response) -> String {
    let mut body: Vec<u8> = Vec::new();
    while body.len() < MAX_ERROR_BODY {
        match resp.chunk().await {
            Ok(Some(chunk)) => body.extend_from_slice(&chunk),
            Ok(None) | Err(_) => break,
        }
    }
    body.truncate(MAX_ERROR_BODY);
    String::from_utf8_lossy(&body).into_owned()
}

/// A response whose BODY could not be read or decoded (#274).
///
/// `reqwest` reports both as `Kind::Decode`, so classifying every one of them
/// `internal` told the frontend a completed-but-malformed answer — a contract
/// break with VMark's own server, not worth retrying — when the real event was
/// a read that timed out or a connection that never opened. Those are asked
/// FIRST and keep the codes `transport_failure` gives them; `internal` is left
/// for the case it names. The URL is stripped for the same reason it is there
/// (#276): the graph fetch carries a live session token in its query.
///
/// Residual: a connection reset midway through a body is still `internal`,
/// because reqwest gives it the same kind as a serde failure and exposes
/// nothing that separates the two.
pub(super) fn body_failure(what: &str, e: reqwest::Error) -> CommandError {
    if e.is_timeout() || e.is_connect() || e.is_request() {
        return transport_failure(what, e);
    }
    CommandError::internal(format!(
        "{what} response was not the expected JSON: {}",
        e.without_url()
    ))
}

/// A request that got no answer: `timeout` when the bounded client gave up
/// (#130), `network` for anything else the transport reports.
///
/// The URL is STRIPPED first (#276). `reqwest::Error`'s `Display` appends
/// `for url (…)`, and the two session-in-query calls carry live credentials
/// there — the one-time `/__auth?t=<nonce>` and the `/api/graph?s=<session>`
/// token — so formatting the error whole wrote a working credential into the
/// message the frontend shows and the log keeps. `what` already names which
/// call failed, which is the part a reader needs.
fn transport_failure(what: &str, e: reqwest::Error) -> CommandError {
    let code = if e.is_timeout() {
        ErrorCode::Timeout
    } else {
        ErrorCode::Network
    };
    CommandError::new(code, format!("{what} request failed: {}", e.without_url()))
}

/// A non-2xx answer: the remote call failed, with the status machine-readable
/// in `detail` and, when the server said anything, its body in the message.
pub(super) fn refusal(what: &str, status: StatusCode, body: &str) -> CommandError {
    let body = body.trim();
    let message = if body.is_empty() {
        format!("{what} failed ({status})")
    } else {
        format!("{what} failed ({status}): {body}")
    };
    CommandError::network(message).with_detail(serde_json::json!({ "status": status.as_u16() }))
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
