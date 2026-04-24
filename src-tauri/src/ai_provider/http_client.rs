//! Shared `reqwest::Client` for AI provider REST calls.
//!
//! Building a client per call defeats connection pooling, DNS caching, and
//! TLS session reuse. This module exposes a singleton built on first use and
//! reused thereafter; per-request timeouts are applied via
//! `RequestBuilder::timeout` instead of baked into the client.
//!
//! Initialization can theoretically fail (TLS backend setup) — in that case
//! the error is cached and `shared()` returns the same `Err(String)` on
//! every subsequent call so commands can propagate it through the existing
//! `Result<T, String>` Tauri-command contract instead of crashing the app.
//!
//! @module ai_provider/http_client

use std::sync::OnceLock;
use std::time::Duration;

static SHARED_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

/// Connection-establishment timeout shared across all REST calls.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Idle-pool timeout — keeps connections warm for a minute, then closes them.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// Returns the shared HTTP client, initializing it on first call.
///
/// Per-request timeouts must be set via `client.get(...).timeout(d)`; this
/// client has no global request timeout so callers control their own cap.
pub fn shared() -> Result<&'static reqwest::Client, String> {
    SHARED_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .pool_idle_timeout(POOL_IDLE_TIMEOUT)
                .build()
                .map_err(|e| format!("Failed to build shared HTTP client: {}", e))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_returns_same_instance_across_calls() {
        let a = shared().expect("client builds in test environment");
        let b = shared().expect("client builds in test environment");
        // OnceLock guarantees pointer equality for the cached value.
        assert!(std::ptr::eq(a, b));
    }

    #[test]
    fn shared_returns_ok_when_tls_backend_is_available() {
        // In normal CI/dev, rustls/native-tls initialize fine; this is the
        // happy path that all command call sites assume.
        let result = shared();
        assert!(
            result.is_ok(),
            "shared() must succeed in a normal test environment: {:?}",
            result.err()
        );
    }

    /// Per-request timeout actually fires when the server doesn't respond.
    /// This is the contract the entire R2 fix relies on — without it, the
    /// shared client (which has no global request timeout) would hang forever.
    #[tokio::test(flavor = "multi_thread")]
    async fn per_request_timeout_actually_aborts_a_hung_request() {
        // Bind a TCP listener that accepts the connection then never sends
        // anything. reqwest will complete the TCP handshake but block waiting
        // for an HTTP response — the per-request `.timeout(...)` must fire.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind localhost listener");
        let addr = listener.local_addr().expect("local addr");
        // Spawn an accept loop that holds the connection without responding.
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        // Hold the socket open by leaking a reference into a
                        // long sleep — never close, never write.
                        tokio::spawn(async move {
                            let _hold = stream;
                            tokio::time::sleep(Duration::from_secs(60)).await;
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        let client = shared().expect("client builds in test environment");
        let started = std::time::Instant::now();
        let result = client
            .get(format!("http://{}/", addr))
            .timeout(Duration::from_millis(150))
            .send()
            .await;
        let elapsed = started.elapsed();

        assert!(result.is_err(), "request must error when server hangs");
        let err = result.unwrap_err();
        assert!(
            err.is_timeout(),
            "expected timeout error, got: {}",
            err
        );
        // Generous wall-clock budget keeps the test non-flaky on slow CI.
        assert!(
            elapsed < Duration::from_millis(2_000),
            "timeout fired too late: {:?}",
            elapsed
        );
    }
}
