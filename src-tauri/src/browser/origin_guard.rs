//! Origin canonicalization + grant enforcement in the driver (WI-2.1 / R4 / I3 / R7a).
//!
//! **This is the authoritative enforcement point.** The TS layer
//! (`src/lib/browser/origin/originGuard.ts`) specifies the rules and enforces them
//! early for UX; a caller that skips it — a plugin, a future code path, a bug —
//! must still be unable to drive a non-granted page. That is only true if the
//! check lives here, at the Rust boundary, immediately before dispatch.
//!
//! Canonicalization rules (must mirror the TS spec exactly — a divergence is a
//! security bug):
//!   - scheme + host + port only; userinfo/path/query/fragment discarded
//!   - host is IDN→punycode, lowercased, trailing dot stripped
//!   - default ports normalized (443/80)
//!   - only http/https are navigable origins; data:/blob:/about:/file:/ws: → None
//!   - NO implicit subdomain wildcarding — a pattern must write `*.host`
//!   - `*.example.com` covers strict subdomains at any depth, NOT the apex,
//!     NOT look-alike suffixes (`evil-example.com`)
//!
//! The `url` crate implements the same WHATWG URL spec as the browser's `URL`, so
//! both layers parse identically instead of two hand-rolled parsers drifting apart.
//!
//! @coordinates-with src/lib/browser/origin/originGuard.ts — the mirrored spec
//! @coordinates-with browser/commands.rs — browser_eval calls the gate

use url::{Host, Url};

use crate::browser::operation::is_known_operation;
use crate::browser::registry::BrowserError;

// The closed operation vocabulary lives in `browser/operation.rs`; `NEVER_AUTOMATED`
// is re-exported for `one_shot.rs`, which imports it through the guard's surface.
pub(crate) use crate::browser::operation::NEVER_AUTOMATED;

/// A canonical web origin: scheme + host + port, nothing else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalOrigin {
    /// Lowercased scheme without the trailing colon, e.g. "https".
    pub scheme: String,
    /// Punycode ASCII host, lowercased, trailing dot stripped. IPv6 keeps brackets.
    pub host: String,
    /// Explicit port with default ports (443/80) filled in.
    pub port: u16,
}

/// Stable string key for a canonical origin: `scheme://host:port`.
///
/// Part of the spec surface this module mirrors from `originGuard.ts`; the parity
/// tests are its only caller today. The enforcement path (`browser_eval`) goes
/// through `is_driver_operation_allowed`, which never needs a string key.
#[allow(
    dead_code,
    reason = "TS-parity spec surface, exercised by the parity tests"
)]
pub fn origin_key(o: &CanonicalOrigin) -> String {
    format!("{}://{}:{}", o.scheme, o.host, o.port)
}

/// A scoped standing grant: an origin pattern + the operations it authorizes.
/// Deserialized from the frontend approval store (`browser_set_grants`).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct StandingGrant {
    /// Origin pattern: `https://host`, `https://host:port`, or `https://*.host`.
    #[serde(rename = "originPattern")]
    pub origin_pattern: String,
    /// Operations authorized on that origin, e.g. `["read","click","type"]`.
    pub operations: Vec<String>,
}

/// Parse an input URL into a canonical web origin, or `None` if it is not a
/// navigable http(s) origin (opaque scheme, missing host, or unparseable).
pub fn canonicalize_origin(input: &str) -> Option<CanonicalOrigin> {
    let url = Url::parse(input.trim()).ok()?;

    // Only http/https are navigable origins.
    let (scheme, default_port) = match url.scheme() {
        "https" => ("https", 443u16),
        "http" => ("http", 80u16),
        _ => return None,
    };

    // `Url::host()` yields the parsed host: Domain is already punycode +
    // lowercased by the WHATWG parser (same as the browser's URL), and IPv6 is a
    // structured address rather than a bracketed string.
    let host = match url.host()? {
        Host::Domain(d) => {
            // Strip EXACTLY ONE trailing dot, like the TS `replace(/\.$/,"")`, so
            // `example.com.` is the bare origin but `example.com..` does NOT collapse
            // to `example.com` and match its grant (the old `trim_end_matches` did).
            let trimmed = d.strip_suffix('.').unwrap_or(d);
            if trimmed.is_empty() {
                return None;
            }
            // Reject any remaining empty label (`example.com..` → `example.com.`
            // still ends in one; also `https://.com`, `a..b.com`).
            if trimmed.split('.').any(|label| label.is_empty()) {
                return None;
            }
            trimmed.to_ascii_lowercase()
        }
        // Bracket IPv6 so the string form matches the TS layer's `url.hostname`.
        Host::Ipv6(addr) => format!("[{addr}]"),
        Host::Ipv4(addr) => addr.to_string(),
    };

    Some(CanonicalOrigin {
        scheme: scheme.to_string(),
        host,
        port: url.port().unwrap_or(default_port),
    })
}

/// A parsed grant pattern: a canonical base origin plus the wildcard flag.
struct ParsedPattern {
    origin: CanonicalOrigin,
    wildcard: bool,
}

/// Parse a grant pattern into a canonical base origin + wildcard flag, or `None`
/// if malformed. Single source of truth for matching and validation.
///
/// SECURITY: a pattern must be a BARE origin. Userinfo, path, query, or fragment
/// are rejected — not stripped — because the URL parser would otherwise silently
/// reinterpret `https://*.example.com@evil.com` as authority `evil.com`. A target
/// URL legitimately carries those parts; a grant pattern must not, so patterns
/// get stricter parsing than targets.
fn parse_origin_pattern(pattern: &str) -> Option<ParsedPattern> {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut wildcard = false;
    let mut candidate = trimmed.to_string();

    const MARKER: &str = "://*.";
    if let Some(idx) = trimmed.find(MARKER) {
        wildcard = true;
        let scheme = &trimmed[..idx];
        let base = &trimmed[idx + MARKER.len()..];
        if base.is_empty() || base.starts_with('.') {
            return None;
        }
        candidate = format!("{scheme}://{base}");
    }
    // Stray wildcard (`https://*`, `https://ex*ample.com`).
    if candidate.contains('*') {
        return None;
    }

    // Reject any pattern that is not a bare origin.
    let url = Url::parse(&candidate).ok()?;
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    if !url.path().is_empty() && url.path() != "/" {
        return None;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }

    let origin = canonicalize_origin(&candidate)?;
    Some(ParsedPattern { origin, wildcard })
}

/// Is `pattern` a well-formed grant pattern the driver could enforce?
///
/// `browser_add_one_shot` calls this to reject a pattern the guard could never
/// match, rather than storing inert authority that silently never fires.
pub fn is_origin_pattern(pattern: &str) -> bool {
    parse_origin_pattern(pattern).is_some()
}

/// Does a canonical target origin match a grant pattern?
///
/// Exact on scheme and port; the host is either exact, or (for `*.base`) a strict
/// subdomain of `base` — never the apex, never a look-alike suffix.
pub fn origin_matches_pattern(target: &CanonicalOrigin, pattern: &str) -> bool {
    let Some(parsed) = parse_origin_pattern(pattern) else {
        return false;
    };
    if target.scheme != parsed.origin.scheme || target.port != parsed.origin.port {
        return false;
    }
    if parsed.wildcard {
        // The leading dot is what makes this a STRICT subdomain test: it rejects
        // both the apex ("a.com") and look-alikes ("evil-a.com").
        return target.host.ends_with(&format!(".{}", parsed.origin.host));
    }
    target.host == parsed.origin.host
}

/// Is the target URL granted by at least one pattern? Default-deny: an empty
/// grant set, or a target that is not a navigable origin, grants nothing.
///
/// Spec surface (see `origin_key`): the enforcement path always asks the
/// *operation* question (`is_driver_operation_allowed`), never the coarser
/// origin-only one, because an origin grant is never blanket authority.
#[allow(
    dead_code,
    reason = "TS-parity spec surface, exercised by the parity tests"
)]
pub fn is_origin_granted(target_url: &str, grants: &[String]) -> bool {
    let Some(target) = canonicalize_origin(target_url) else {
        return false;
    };
    grants.iter().any(|p| origin_matches_pattern(&target, p))
}

/// May `operation` run on `target_url` under the current standing grants?
///
/// This is the decision `browser_eval` enforces. Default-deny, and hard-deny for
/// never-automatable operations regardless of any grant (R5).
pub fn is_operation_granted(target_url: &str, operation: &str, grants: &[StandingGrant]) -> bool {
    // Closed vocabulary first (parity with `decideApproval`) — a grant listing a
    // variant `"Upload"` cannot authorize it, and hard-deny never-automatable ops.
    if !is_known_operation(operation) || NEVER_AUTOMATED.contains(&operation) {
        return false;
    }
    let Some(target) = canonicalize_origin(target_url) else {
        return false;
    };
    grants.iter().any(|g| {
        g.operations.iter().any(|op| op == operation)
            && origin_matches_pattern(&target, &g.origin_pattern)
    })
}

/// The driver's complete policy decision for a command against a **committed**
/// page. This is the single audited place where "may the driver do this?" is
/// answered; `browser_eval` calls exactly this and nothing else.
///
/// Two rules, both from the plan:
///   - **`read` is granted per-tab on any committed navigable origin (R7a)** — the
///     user (or an already-approved `act`) put the page there, and the AI has no
///     navigate tool, so reading it needs no standing grant (still refused on a
///     non-navigable origin).
///   - **Every other operation requires an explicit standing grant (R4/R5)**, and
///     `upload` is refused unconditionally. The read grant must never leak into
///     write authority: "read my blog" must not become "publish to my blog".
pub fn is_driver_operation_allowed(
    committed_url: &str,
    operation: &str,
    grants: &[StandingGrant],
) -> bool {
    // Closed vocabulary first — not even the per-tab `read` path (`"Read"` ≠ `read`).
    if !is_known_operation(operation) || NEVER_AUTOMATED.contains(&operation) {
        return false;
    }
    if operation == "read" {
        // R7a per-tab read grant — scoped to a real web origin.
        return canonicalize_origin(committed_url).is_some();
    }
    is_operation_granted(committed_url, operation, grants)
}

/// Validate a navigation target: only well-formed http/https URLs are navigable.
/// Opaque origins (`about:`/`data:`/`blob:`/`file:`/`javascript:`) are rejected
/// for the driver-owned surface (R7a).
///
/// Returns the **exact string the caller must load** (the trimmed input). The
/// gate used to validate `url.trim()` and return `()`, so callers went on to load
/// the *untrimmed* original — validated value ≠ consumed value. Handing the
/// checked value back makes that divergence unrepresentable.
///
/// Uses the same WHATWG parser as the origin canonicalizer, so malformed
/// authorities (`https://@`, `https://:443`, `https://exa mple.com`) are rejected.
///
/// Deliberately STRICTER than bare canonicalization (only this navigation gate, so
/// origin comparison stays WHATWG-faithful — parity is the security property): it
/// requires an explicit `http(s)://` prefix and no backslashes, refusing the
/// shorthand/empty-authority forms (`https:/path`, `https:path`, `https:///path`,
/// `https://\path`) that WHATWG would reinterpret so the first path segment becomes
/// the host — legal parsing, but never what a caller meant.
pub fn validate_navigation_url(url: &str) -> Result<String, BrowserError> {
    let trimmed = url.trim();
    let invalid = || BrowserError::InvalidUrl(url.to_string());

    // Require an explicit `http://`/`https://` prefix and reject backslashes: both
    // close authority-reinterpretation forms the bare-`://` check below missed.
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || trimmed.contains('\\') {
        return Err(invalid());
    }

    // Reject an empty authority (`https:///path` → host `path`).
    if let Some(after_scheme) = trimmed.split_once("://").map(|(_, rest)| rest) {
        if after_scheme.starts_with('/') {
            return Err(invalid());
        }
    }

    canonicalize_origin(trimmed)
        .map(|_| trimmed.to_string())
        .ok_or_else(invalid)
}

#[cfg(test)]
#[path = "origin_guard.test.rs"]
mod tests;
