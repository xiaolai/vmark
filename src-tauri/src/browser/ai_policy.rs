//! AI browser navigation policy (WI-N1.3 / R4).
//!
//! This validator is deliberately separate from the human omnibox validator. The
//! human browser may visit local development services; AI navigation must reject
//! private and special-use destinations before WebKit receives a request.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

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

/// The IPv4 address a transition-prefix IPv6 address EMBEDS, if any — such an
/// address is exactly as reachable as its payload, so it must be exactly as
/// blocked (WI-NB3.2; the disguise classes NeoBrowser's guard covered):
/// IPv4-mapped/compatible (`::ffff:a.b.c.d`, `::a.b.c.d`), 6to4 (`2002:VVVV:WWWW::/16`,
/// v4 in bits 16–47), and the NAT64 well-known prefix (`64:ff9b::/96`, v4 in the
/// last 32 bits).
fn embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    // Covers both IPv4-mapped and the deprecated IPv4-compatible form.
    if let Some(v4) = v6.to_ipv4() {
        // `to_ipv4` maps `::` and `::1` too; those are already handled as v6.
        if !v6.is_unspecified() && !v6.is_loopback() {
            return Some(v4);
        }
    }
    let seg = v6.segments();
    if seg[0] == 0x2002 {
        return Some(Ipv4Addr::from(((seg[1] as u32) << 16) | seg[2] as u32));
    }
    if seg[0] == 0x64
        && seg[1] == 0xff9b
        && seg[2] == 0
        && seg[3] == 0
        && seg[4] == 0
        && seg[5] == 0
    {
        return Some(Ipv4Addr::from(((seg[6] as u32) << 16) | seg[7] as u32));
    }
    None
}

fn blocked_ip(address: IpAddr, allow_loopback: bool) -> bool {
    match address {
        IpAddr::V4(v4) => blocked_ipv4(v4, allow_loopback),
        IpAddr::V6(v6) => {
            if let Some(embedded) = embedded_ipv4(v6) {
                return blocked_ipv4(embedded, allow_loopback);
            }
            v6.is_unspecified()
                || v6.is_loopback() && !allow_loopback
                || v6.is_multicast()
                || in_ipv6_range(v6, Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7)
                || in_ipv6_range(v6, Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10)
                // Deprecated site-local — still routable on legacy LANs.
                || in_ipv6_range(v6, Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 0), 10)
                || in_ipv6_range(v6, Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32)
                || in_ipv6_range(v6, Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 32)
                || in_ipv6_range(v6, Ipv6Addr::new(0x2001, 2, 0, 0, 0, 0, 0, 0), 48)
                || in_ipv6_range(v6, Ipv6Addr::new(0x2001, 0x10, 0, 0, 0, 0, 0, 0), 28)
        }
    }
}

fn blocked_ipv4(address: Ipv4Addr, allow_loopback: bool) -> bool {
    let value = u32::from(address);
    let loopback = in_ipv4_range(value, 0x7f00_0000, 8);
    let private = in_ipv4_range(value, 0x0a00_0000, 8)
        || in_ipv4_range(value, 0xac10_0000, 12)
        || in_ipv4_range(value, 0xc0a8_0000, 16);
    let link_local = in_ipv4_range(value, 0xa9fe_0000, 16);
    let shared = in_ipv4_range(value, 0x6440_0000, 10);
    let special = in_ipv4_range(value, 0, 8)
        || in_ipv4_range(value, 0xc000_0000, 24)
        || in_ipv4_range(value, 0xc000_0200, 24)
        || in_ipv4_range(value, 0xc058_6300, 24)
        || in_ipv4_range(value, 0xc612_0000, 15)
        || in_ipv4_range(value, 0xc633_6400, 24)
        || in_ipv4_range(value, 0xcb00_7100, 24)
        || in_ipv4_range(value, 0xe000_0000, 4)
        || in_ipv4_range(value, 0xf000_0000, 4);

    (loopback && !allow_loopback) || private || link_local || shared || special
}

fn in_ipv4_range(address: u32, network: u32, prefix: u8) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    address & mask == network & mask
}

fn in_ipv6_range(address: Ipv6Addr, network: Ipv6Addr, prefix: u8) -> bool {
    let address = u128::from(address);
    let network = u128::from(network);
    let mask = if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    };
    address & mask == network & mask
}

/// Parse the alternate IPv4 spellings accepted by browser URL parsers. Treating
/// these as hostnames would leave `2130706433` and `127.1` as loopback bypasses.
fn parse_legacy_ipv4(host: &str) -> Option<Ipv4Addr> {
    let looks_numeric = host
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.' || c == 'x' || c == 'X' || c.is_ascii_hexdigit());
    if !looks_numeric || !host.contains(|c: char| c.is_ascii_digit()) {
        return None;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.is_empty() || parts.len() > 4 || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    let values = parts
        .iter()
        .map(|part| parse_number(part))
        .collect::<Option<Vec<u64>>>()?;
    let value = match values.as_slice() {
        [a] if *a <= 0xffff_ffff => *a,
        [a, b] if *a <= 0xff && *b <= 0xff_ffff => (a << 24) | b,
        [a, b, c] if *a <= 0xff && *b <= 0xff && *c <= 0xffff => (a << 24) | (b << 16) | c,
        [a, b, c, d] if [a, b, c, d].iter().all(|v| **v <= 0xff) => {
            (a << 24) | (b << 16) | (c << 8) | d
        }
        _ => return None,
    };
    Some(Ipv4Addr::from(value as u32))
}

fn parse_number(value: &str) -> Option<u64> {
    let (digits, radix) = if let Some(rest) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        (rest, 16)
    } else if let Some(rest) = value
        .strip_prefix("0o")
        .or_else(|| value.strip_prefix("0O"))
    {
        (rest, 8)
    } else if value.starts_with('0') && value.len() > 1 {
        (value, 8)
    } else {
        (value, 10)
    };
    if digits.is_empty() {
        return None;
    }
    u64::from_str_radix(digits, radix).ok()
}

#[cfg(test)]
#[path = "ai_policy.test.rs"]
mod tests;
