//! AI browser navigation policy (WI-N1.3 / R4).
//!
//! This validator is deliberately separate from the human omnibox validator. The
//! human browser may visit local development services; AI navigation must reject
//! private and special-use destinations before WebKit receives a request.

use std::net::IpAddr;

use super::ai_policy_addr::{blocked_ipv4, blocked_ipv6, parse_legacy_ipv4};

use url::Url;

use crate::browser::registry::AutomationMode;

/// Why an AI destination was rejected.
///
/// The two arms are NOT interchangeable (audit 20260803 §6). `Blocked` is a
/// policy refusal the caller can do nothing about; `Invalid` means the argument
/// never named a destination at all. Collapsing them reported empty strings and
/// typos to the user — and to the AI client, as `SSRF_BLOCKED` — as security
/// refusals, which both buried the real ones and told the caller that fixing
/// its input was pointless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiUrlError {
    /// Parses fine; policy says no. No re-formatting will help.
    Blocked,
    /// Not a usable URL: empty, unparsable, or missing a host.
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiSessionMode {
    Sandbox,
    Shared,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiBrowserPolicy {
    pub enabled: bool,
    pub session: AiSessionMode,
    pub allow_loopback: bool,
    pub epoch: u64,
}

impl Default for AiBrowserPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            session: AiSessionMode::Sandbox,
            allow_loopback: false,
            epoch: 0,
        }
    }
}

impl AiBrowserPolicy {
    pub fn automation_mode(self) -> AutomationMode {
        match self.session {
            AiSessionMode::Sandbox => AutomationMode::AiSandbox,
            AiSessionMode::Shared => AutomationMode::AiShared,
        }
    }
}

/// Validate an AI destination and return the exact trimmed URL to load.
///
/// Rejections split two ways — see [`AiUrlError`]. The rule for placing a new
/// check: if a corrected argument could pass it, the check is `Invalid`; if the
/// destination is simply out of bounds, it is `Blocked`. A non-http(s) scheme
/// and embedded credentials are `Blocked`, not `Invalid`: both are well-formed
/// requests to reach somewhere the AI may not go (`file:///etc/passwd`,
/// credential smuggling), so inviting the caller to fix them would be wrong.
pub fn validate_ai_navigation_url(input: &str, allow_loopback: bool) -> Result<String, AiUrlError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(AiUrlError::Invalid);
    }
    let lower = value.to_ascii_lowercase();
    // A backslash is a URL-parser divergence trick (`https://example.com\@evil`)
    // and the prefix check keeps every other scheme out — both are policy.
    if value.contains('\\') || !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AiUrlError::Blocked);
    }

    let parsed = Url::parse(value).map_err(|_| AiUrlError::Invalid)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AiUrlError::Blocked);
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AiUrlError::Blocked);
    }

    // No host at all — `https://` on its own, or `https://:8080/`. There is no
    // destination here to have an opinion about.
    let host = parsed.host_str().ok_or(AiUrlError::Invalid)?;
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host.is_empty()
        || normalized_host.contains('.') && normalized_host.starts_with('.')
    {
        return Err(AiUrlError::Invalid);
    }

    let ip = parsed.host().and_then(|host| match host {
        url::Host::Ipv4(address) => Some(IpAddr::V4(address)),
        url::Host::Ipv6(address) => Some(IpAddr::V6(address)),
        url::Host::Domain(_) => parse_legacy_ipv4(&normalized_host).map(IpAddr::V4),
    });

    if let Some(address) = ip {
        if blocked_ip(address, allow_loopback) {
            return Err(AiUrlError::Blocked);
        }
    } else if blocked_hostname(&normalized_host, allow_loopback) {
        return Err(AiUrlError::Blocked);
    }

    Ok(value.to_string())
}

/// May a tab load `url` in a SUBFRAME (audit 20260903 P-01)?
///
/// The navigation delegate sees every frame's navigation, and used to allow any
/// non-main-frame load unconditionally — so an iframe on a public page an AI opened
/// with zero approval could point at a LAN or metadata address. An AI-owned tab now
/// runs the same destination check for a subframe as for its main frame; a human
/// tab keeps its behaviour. Nothing is minted and nothing is emitted for a refused
/// subframe: it is cancelled, and the page simply has a frame that did not load.
///
/// `about:`, `blob:` and `data:` frames are allowed: they reach no network, and
/// `about:blank` / `srcdoc` frames are how ordinary pages build portals and ad
/// slots — refusing them would break the page for nothing. Every other scheme goes
/// through the validator, which refuses `file:`, `ftp:` and the private ranges.
/// Subresources (images, scripts, fetches) never reach the delegate at all; the
/// content rule list in `ai_content_rules.rs` covers those.
pub fn subframe_load_allowed(mode: AutomationMode, policy: &AiBrowserPolicy, url: &str) -> bool {
    if mode == AutomationMode::Human {
        return true;
    }
    if !policy.enabled {
        return false;
    }
    let lower = url.trim().to_ascii_lowercase();
    if ["about:", "blob:", "data:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return true;
    }
    validate_ai_navigation_url(url, policy.allow_loopback).is_ok()
}

/// May a SAME-DOCUMENT navigation to `url` stand on a tab of `mode` bound to
/// `tab_epoch` (audit 20260903 round 3, #21)? The pure half of the KVO observer's
/// decision: the browser must be on; an AI tab must be bound to the current
/// posture epoch and its destination must pass the navigation policy; a shared tab
/// must also be inside the origin its current navigation was approved for
/// (`shared_approved`, read from the registry). A human tab needs only the
/// feature to be on.
pub fn same_document_allowed(
    mode: AutomationMode,
    policy: &AiBrowserPolicy,
    tab_epoch: u64,
    shared_approved: bool,
    url: &str,
) -> bool {
    if !policy.enabled {
        return false;
    }
    let ai_destination_ok = || {
        tab_epoch == policy.epoch && validate_ai_navigation_url(url, policy.allow_loopback).is_ok()
    };
    match mode {
        AutomationMode::Human => true,
        AutomationMode::AiSandbox => ai_destination_ok(),
        AutomationMode::AiShared => ai_destination_ok() && shared_approved,
    }
}

fn blocked_hostname(host: &str, allow_loopback: bool) -> bool {
    (matches!(host, "localhost") || host.ends_with(".localhost")) && !allow_loopback
        || matches!(host, "metadata" | "instance-data")
        || host == "metadata.google.internal"
        || host.ends_with(".metadata.google.internal")
        || lan_facing_suffix(host)
}

/// LAN-facing name suffixes (WI-1.7).
///
/// These never reach the IP-literal blocks: they parse as `Host::Domain`, so
/// `blocked_ip` is not consulted at all and the request leaves the machine to
/// whatever mDNS/DNS returns — typically a router, NAS, printer, or cloud instance
/// on the same network. Blocking by NAME is the only point at which that can be
/// refused before WebKit resolves the host.
///
/// **Not** gated behind `allow_loopback`, deliberately. That toggle means "my own
/// machine"; these are LAN *peers*, so folding them in would silently widen a
/// single-host opt-in to an entire network.
///
/// Suffix-anchored on a label boundary, never substring: `notlocal.com` and
/// `internal.example.com` are ordinary public names and stay navigable.
fn lan_facing_suffix(host: &str) -> bool {
    const SUFFIXES: &[&str] = &[
        // RFC 6762 multicast DNS — resolves to peers on the local link.
        "local",
        // RFC 8375 — the reserved name for home networks.
        "home.arpa",
        // AWS (`*.compute.internal`) / GCP (`*.internal`) instance and metadata names.
        "internal",
    ];
    SUFFIXES.iter().any(|suffix| {
        host == *suffix || host.len() > suffix.len() && host.ends_with(&format!(".{suffix}"))
    })
}

/// Both address families are TABLE-driven (`ai_policy_addr.rs`): `BLOCKED_IPV4_RANGES`
/// and `BLOCKED_IPV6_RANGES` are the declarative source, and the WebKit content rule
/// list is derived from the same two tables and parity-tested against them, so a
/// range can no longer be blocked for navigation and reachable as a subresource.
fn blocked_ip(address: IpAddr, allow_loopback: bool) -> bool {
    match address {
        IpAddr::V4(v4) => blocked_ipv4(v4, allow_loopback),
        IpAddr::V6(v6) => blocked_ipv6(v6, allow_loopback),
    }
}

#[cfg(test)]
#[path = "ai_policy.test.rs"]
mod tests;
