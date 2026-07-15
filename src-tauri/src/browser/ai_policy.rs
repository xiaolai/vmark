//! AI browser navigation policy (WI-N1.3 / R4).
//!
//! This validator is deliberately separate from the human omnibox validator. The
//! human browser may visit local development services; AI navigation must reject
//! private and special-use destinations before WebKit receives a request.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::Url;

use crate::browser::registry::AutomationMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiUrlError {
    Blocked,
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
pub fn validate_ai_navigation_url(input: &str, allow_loopback: bool) -> Result<String, AiUrlError> {
    let value = input.trim();
    let lower = value.to_ascii_lowercase();
    if value.is_empty()
        || value.contains('\\')
        || !(lower.starts_with("http://") || lower.starts_with("https://"))
    {
        return Err(AiUrlError::Blocked);
    }

    let parsed = Url::parse(value).map_err(|_| AiUrlError::Blocked)?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AiUrlError::Blocked);
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AiUrlError::Blocked);
    }

    let host = parsed.host_str().ok_or(AiUrlError::Blocked)?;
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host.is_empty() || normalized_host.contains('.') && normalized_host.starts_with('.') {
        return Err(AiUrlError::Blocked);
    }

    let ip = parsed
        .host()
        .and_then(|host| match host {
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
}

fn blocked_ip(address: IpAddr, allow_loopback: bool) -> bool {
    match address {
        IpAddr::V4(v4) => blocked_ipv4(v4, allow_loopback),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return blocked_ipv4(mapped, allow_loopback);
            }
            v6.is_unspecified()
                || v6.is_loopback() && !allow_loopback
                || v6.is_multicast()
                || in_ipv6_range(v6, Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7)
                || in_ipv6_range(v6, Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10)
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
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    address & mask == network & mask
}

fn in_ipv6_range(address: Ipv6Addr, network: Ipv6Addr, prefix: u8) -> bool {
    let address = u128::from(address);
    let network = u128::from(network);
    let mask = if prefix == 0 { 0 } else { u128::MAX << (128 - prefix) };
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
        [a, b, c] if *a <= 0xff && *b <= 0xff && *c <= 0xffff => {
            (a << 24) | (b << 16) | c
        }
        [a, b, c, d] if [a, b, c, d].iter().all(|v| **v <= 0xff) => {
            (a << 24) | (b << 16) | (c << 8) | d
        }
        _ => return None,
    };
    Some(Ipv4Addr::from(value as u32))
}

fn parse_number(value: &str) -> Option<u64> {
    let (digits, radix) = if let Some(rest) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        (rest, 16)
    } else if let Some(rest) = value.strip_prefix("0o").or_else(|| value.strip_prefix("0O")) {
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
