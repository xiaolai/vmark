//! Resolved-address pre-flight for AI-initiated navigations (audit 20260903
//! round 4, #7 / #8).
//!
//! Purpose: `validate_ai_navigation_url` judges URL TEXT. A public-looking
//! hostname whose DNS answer is a loopback, LAN or cloud-metadata address passes
//! it, and the request then reaches the network the policy exists to keep the AI
//! out of. WKWebView exposes no per-request hook for the address a connection
//! actually uses, so FULL enforcement — every subresource, and a DNS answer that
//! changes after the check (rebinding) — is not available on this platform. What
//! is available is a pre-flight: resolve the name BEFORE the navigation is
//! issued and refuse when any answer is an address the policy blocks.
//!
//! Key decisions:
//!   - Fail closed. No answer, a lookup error, or a bounded wait that expires all
//!     REFUSE (`PreflightReason::Unresolved`); a navigation is never allowed by
//!     default. `RESOLVE_TIMEOUT` bounds the wait because a stalled resolver would
//!     otherwise hold the command for the OS resolver's own retry schedule.
//!   - Any blocked address in the answer refuses: a resolver may return several
//!     records and the connection may use any of them, so one private A record
//!     among public ones is the whole attack.
//!   - IP literals — the legacy spellings included — skip resolution. The
//!     pre-flight runs after the URL validator, which has already judged a
//!     literal; resolving one would only ask the OS to echo it back.
//!   - The address judgement is `ai_policy::blocked_ip`, the SAME predicate the
//!     URL validator applies to a literal, so a name can never resolve to an
//!     address whose literal form is refused.
//!   - The resolver is INJECTED (`DestinationResolver`) so the unit tests never
//!     touch the network; `SystemResolver` is the production one.
//!   - Resolution runs on a worker thread and the caller waits with a bound,
//!     never under a lock: the navigation delegate on the main thread takes the
//!     surface's locks, and a lookup held under one would stall the UI. For the
//!     same reason nothing here is called from the WKNavigationDelegate —
//!     redirect targets and in-page link clicks stay URL-text checks (plus the
//!     content rule list for literal private addresses).
//!
//! @coordinates-with browser/ai_policy.rs — `blocked_ip`, the address judgement reused here
//! @coordinates-with browser/ai_policy_addr.rs — `parse_legacy_ipv4`, the literal spellings skipped
//! @coordinates-with browser/ai_transactions.rs — the only caller (`create_native` / `navigate_native`)

use std::fmt;
use std::net::{IpAddr, ToSocketAddrs};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use url::Url;

use super::ai_policy::blocked_ip;
use super::ai_policy_addr::parse_legacy_ipv4;

/// How long a pre-flight waits for the OS resolver. A public name answers in
/// milliseconds; one that takes longer than this is a name the resolver is
/// already failing on, and the AI client is waiting on the command meanwhile.
pub(crate) const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Why a lookup produced no answer. Both arms are refused identically by the
/// pre-flight (`Unresolved`); they are distinguished for the log line, since a
/// timeout and an NXDOMAIN call for different investigations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ResolveFailure {
    /// The bounded wait expired before the resolver answered.
    Timeout,
    /// The resolver answered with an error, or never answered at all.
    Lookup(String),
}

impl fmt::Display for ResolveFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => f.write_str("the bounded wait expired"),
            Self::Lookup(error) => write!(f, "lookup failed: {error}"),
        }
    }
}

/// The pre-flight's one outside input: what does `host` resolve to?
pub(crate) trait DestinationResolver {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ResolveFailure>;
}

/// The OS resolver (`getaddrinfo`, via `ToSocketAddrs`), bounded by `timeout`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SystemResolver {
    pub timeout: Duration,
}

impl Default for SystemResolver {
    fn default() -> Self {
        Self {
            timeout: RESOLVE_TIMEOUT,
        }
    }
}

impl DestinationResolver for SystemResolver {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ResolveFailure> {
        resolve_destination(host, self.timeout)
    }
}

/// Resolve `host` with the OS resolver, waiting at most `timeout`. Each address
/// appears once, in the order the resolver returned them.
pub(crate) fn resolve_destination(
    host: &str,
    timeout: Duration,
) -> Result<Vec<IpAddr>, ResolveFailure> {
    let host = host.to_owned();
    bounded_lookup(timeout, move || {
        (host.as_str(), 0)
            .to_socket_addrs()
            .map(|addrs| {
                let mut seen: Vec<IpAddr> = Vec::new();
                for address in addrs.map(|socket| socket.ip()) {
                    if !seen.contains(&address) {
                        seen.push(address);
                    }
                }
                seen
            })
            .map_err(|error| ResolveFailure::Lookup(error.to_string()))
    })
}

/// Run `lookup` on a worker thread and wait at most `timeout` for its answer.
/// The wait is the whole point: `getaddrinfo` has no timeout parameter, and a
/// resolver that is down retries on its own schedule. A worker that outlives the
/// wait finishes on its own and its late answer is dropped; a worker that dies
/// without answering is a refusal, not an allow.
pub(crate) fn bounded_lookup<T: Send + 'static>(
    timeout: Duration,
    lookup: impl FnOnce() -> Result<T, ResolveFailure> + Send + 'static,
) -> Result<T, ResolveFailure> {
    let (tx, rx) = mpsc::channel();
    let spawned = thread::Builder::new()
        .name("ai-destination-preflight".into())
        .spawn(move || {
            // A dropped receiver (the wait already expired) makes this a no-op.
            let _ = tx.send(lookup());
        });
    if let Err(error) = spawned {
        return Err(ResolveFailure::Lookup(format!(
            "resolver thread could not start: {error}"
        )));
    }
    match rx.recv_timeout(timeout) {
        Ok(answer) => answer,
        Err(RecvTimeoutError::Timeout) => Err(ResolveFailure::Timeout),
        Err(RecvTimeoutError::Disconnected) => Err(ResolveFailure::Lookup(
            "resolver thread exited without an answer".into(),
        )),
    }
}

/// May the AI reach a destination that resolved to `addrs` under this posture?
/// Empty is `false` — no answer is not permission — and one blocked address
/// among many is `false`.
pub(crate) fn destination_allowed(addrs: &[IpAddr], allow_loopback: bool) -> bool {
    !addrs.is_empty()
        && !addrs
            .iter()
            .any(|address| blocked_ip(*address, allow_loopback))
}

/// Why the pre-flight refused, as the wire token in `detail.reason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreflightReason {
    /// At least one resolved address is one the policy blocks.
    ResolvesPrivate,
    /// No usable answer: empty, a lookup error, the bound expired — or no host.
    Unresolved,
}

impl PreflightReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::ResolvesPrivate => "resolves-private",
            Self::Unresolved => "unresolved",
        }
    }
}

/// A refused pre-flight: the normalized host and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DestinationRefused {
    pub host: String,
    pub reason: PreflightReason,
}

/// What `url` names, as far as resolution is concerned.
enum Destination {
    /// An IP literal in any spelling the URL parser accepts — already judged.
    Literal,
    /// A name to resolve, lowercased and without a trailing dot.
    Name(String),
    /// Nothing resolvable: unparsable, or no host at all.
    Missing,
}

fn destination_of(url: &str) -> Destination {
    let Ok(parsed) = Url::parse(url.trim()) else {
        return Destination::Missing;
    };
    match parsed.host() {
        Some(url::Host::Ipv4(_)) | Some(url::Host::Ipv6(_)) => Destination::Literal,
        Some(url::Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if parse_legacy_ipv4(&name).is_some() {
                Destination::Literal
            } else {
                Destination::Name(name)
            }
        }
        None => Destination::Missing,
    }
}

/// Pre-flight `url`: `Ok` when the destination may be navigated to — a literal
/// host, or a name every address of which the policy allows under this posture.
pub(crate) fn preflight_destination(
    resolver: &dyn DestinationResolver,
    url: &str,
    allow_loopback: bool,
) -> Result<(), DestinationRefused> {
    let host = match destination_of(url) {
        Destination::Literal => return Ok(()),
        Destination::Missing => {
            return Err(DestinationRefused {
                host: url.trim().to_owned(),
                reason: PreflightReason::Unresolved,
            })
        }
        Destination::Name(host) => host,
    };
    let reason = match resolver.resolve(&host) {
        Ok(addrs) if addrs.is_empty() => PreflightReason::Unresolved,
        Ok(addrs) if destination_allowed(&addrs, allow_loopback) => return Ok(()),
        Ok(_) => PreflightReason::ResolvesPrivate,
        Err(failure) => {
            log::warn!("[browser] AI pre-flight could not resolve {host}: {failure}");
            PreflightReason::Unresolved
        }
    };
    Err(DestinationRefused { host, reason })
}

#[cfg(test)]
#[path = "ai_policy_dns.test.rs"]
mod tests;
