//! Address-tier predicates for the AI navigation policy (WI-NB3.2).
//!
//! Split from `ai_policy.rs` along the natural seam: that module owns URL and
//! hostname policy; this one owns pure ADDRESS math — the blocked IPv4/IPv6
//! ranges, the transition-prefix IPv4 extraction (6to4 / NAT64 / mapped /
//! compatible), and the legacy IPv4 spellings browser URL parsers accept
//! (`2130706433`, `0x7f000001`, `127.1`). Everything here is pure and
//! platform-free; the policy tests in `ai_policy.test.rs` exercise it through
//! `validate_ai_navigation_url`, the one public entry point.

use std::net::{Ipv4Addr, Ipv6Addr};

/// The IPv4 address a transition-prefix IPv6 address EMBEDS, if any — such an
/// address is exactly as reachable as its payload, so it must be exactly as
/// blocked (WI-NB3.2; the disguise classes NeoBrowser's guard covered):
/// IPv4-mapped/compatible (`::ffff:a.b.c.d`, `::a.b.c.d`), 6to4 (`2002:VVVV:WWWW::/16`,
/// v4 in bits 16–47), and the NAT64 well-known prefix (`64:ff9b::/96`, v4 in the
/// last 32 bits).
pub(crate) fn embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
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

/// Loopback, gated separately by `allow_loopback` ("my own machine").
pub(crate) const IPV4_LOOPBACK: (u32, u8) = (0x7f00_0000, 8);

/// Every IPv4 range an AI tab may never reach, loopback aside: `(network, prefix)`.
///
/// THE declarative source. `blocked_ipv4` consults it, and the WebKit content
/// rule list (`ai_content_rules.rs`) is parity-tested against it range by range,
/// so a range added here without a matching url-filter fails a test rather than
/// silently reaching subresources while navigation refuses it — which is exactly
/// the drift the first list shipped with (six of these ranges were missing).
pub(crate) const BLOCKED_IPV4_RANGES: &[(u32, u8)] = &[
    // RFC 1918 private.
    (0x0a00_0000, 8),
    (0xac10_0000, 12),
    (0xc0a8_0000, 16),
    // Link-local.
    (0xa9fe_0000, 16),
    // Shared address space (carrier NAT).
    (0x6440_0000, 10),
    // "This" network.
    (0, 8),
    // IETF protocol assignments, TEST-NET-1, 6to4 relay anycast, benchmarking,
    // TEST-NET-2, TEST-NET-3.
    (0xc000_0000, 24),
    (0xc000_0200, 24),
    (0xc058_6300, 24),
    (0xc612_0000, 15),
    (0xc633_6400, 24),
    (0xcb00_7100, 24),
    // Multicast and reserved.
    (0xe000_0000, 4),
    (0xf000_0000, 4),
];

pub(crate) fn blocked_ipv4(address: Ipv4Addr, allow_loopback: bool) -> bool {
    let value = u32::from(address);
    let (loopback_net, loopback_prefix) = IPV4_LOOPBACK;
    let loopback = in_ipv4_range(value, loopback_net, loopback_prefix);
    (loopback && !allow_loopback)
        || BLOCKED_IPV4_RANGES
            .iter()
            .any(|&(network, prefix)| in_ipv4_range(value, network, prefix))
}

fn in_ipv4_range(address: u32, network: u32, prefix: u8) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    address & mask == network & mask
}

pub(crate) fn in_ipv6_range(address: Ipv6Addr, network: Ipv6Addr, prefix: u8) -> bool {
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
pub(crate) fn parse_legacy_ipv4(host: &str) -> Option<Ipv4Addr> {
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
