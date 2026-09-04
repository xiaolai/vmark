//! Bracketed-literal url-filters for an IPv6 CIDR, derived rather than
//! hand-written (audit 20260903 round 3, #9) — the v6 twin of
//! `ai_content_rules_cidr.rs`.
//!
//! Filters must match the address as WebKit SERIALIZES it: the URL Standard's
//! IPv6 serializer, i.e. lowercase hex groups with leading zeros stripped and the
//! FIRST LONGEST run of two or more zero groups replaced by `::`. It never emits
//! the dotted `::ffff:a.b.c.d` form, which is why `render` is written here rather
//! than borrowed from `Ipv6Addr`'s `Display` (that one prints `::0.0.0.2`).
//!
//! A url-filter is a prefix search, so a range only needs its CONSTRAINED groups
//! spelled: the fixed groups, then the boundary group as hex character classes
//! (`fe[8-9a-b][0-9a-f]` for `fe80::/10`), then the `:` that ends a group. Two
//! renderings can carry the same constrained prefix, so a range whose constrained
//! tail is zero emits both — `2001::/32` is `2001:0:` (the zero group written
//! out) and `2001::` (it compressed away).
//!
//! **Preconditions for an EXACT derivation**, all three held by every entry of
//! `BLOCKED_IPV6_RANGES` and pinned by a test over that table: the first group is
//! never zero (an address compressing from group 0 renders `::…` and carries no
//! prefix to key on), any zero among the constrained groups is followed only by
//! zeros, and a boundary group carrying a RANGE excludes zero. A shape violating
//! them still gets a filter — the compressed one is emitted from the first group
//! that can be zero — but a wider one: over-blocking, never under-blocking, which
//! is the safe direction for a blocklist.
//!
//! @coordinates-with browser/ai_policy_addr.rs — BLOCKED_IPV6_RANGES, the table
//! @coordinates-with browser/ai_content_rules.rs — assembles these into the list
//! @coordinates-with browser/ai_content_rules_cidr.rs — hex_patterns, the shared grammar

use std::net::Ipv6Addr;

use super::cidr::hex_patterns;
use super::AUTHORITY;

/// WebKit's serialization of `address`: lowercase hex groups, leading zeros
/// stripped, the first longest run of ≥2 zero groups compressed to `::`.
pub(super) fn render(address: Ipv6Addr) -> String {
    let groups = address.segments();
    let spell = |run: &[u16]| {
        run.iter()
            .map(|group| format!("{group:x}"))
            .collect::<Vec<_>>()
            .join(":")
    };
    let (start, length) = longest_zero_run(&groups);
    if length < 2 {
        return spell(&groups);
    }
    format!(
        "{}::{}",
        spell(&groups[..start]),
        spell(&groups[start + length..])
    )
}

/// `(start, length)` of the FIRST longest run of zero groups.
fn longest_zero_run(groups: &[u16; 8]) -> (usize, usize) {
    let (mut best_start, mut best_len, mut run_start, mut run_len) =
        (0usize, 0usize, 0usize, 0usize);
    for (index, group) in groups.iter().enumerate() {
        if *group == 0 {
            if run_len == 0 {
                run_start = index;
            }
            run_len += 1;
            if run_len > best_len {
                best_start = run_start;
                best_len = run_len;
            }
        } else {
            run_len = 0;
        }
    }
    (best_start, best_len)
}

/// Every url-filter that, together, matches exactly the bracketed IPv6 hosts in
/// `network/prefix` (see the module doc for the preconditions).
pub(super) fn bracket_filters(network: Ipv6Addr, prefix: u8) -> Vec<String> {
    // A single address has ONE rendering: match it whole, up to the `]`.
    if prefix >= 128 {
        return vec![format!("{AUTHORITY}\\[{}\\]", render(network))];
    }
    let groups = network.segments();
    let whole = usize::from(prefix / 16);
    let rest = prefix % 16;
    // The last group the range constrains: the boundary group when the prefix
    // splits one, otherwise the last whole group.
    let last = if rest == 0 {
        whole.saturating_sub(1)
    } else {
        whole
    };
    let head: Vec<String> = groups[..last].iter().map(|g| format!("{g:x}")).collect();
    let boundary: Vec<String> = if rest == 0 {
        vec![format!("{:x}", groups[last])]
    } else {
        let low = u32::from(groups[last]);
        hex_patterns(low, low | (0xffff >> rest))
    };
    let mut filters: Vec<String> = boundary
        .iter()
        .map(|pattern| {
            let spelled: Vec<&str> = head
                .iter()
                .map(String::as_str)
                .chain(std::iter::once(pattern.as_str()))
                .collect();
            // The `:` that ends the last constrained group — present whichever
            // way the rest of the address renders, including `::`.
            format!("{AUTHORITY}\\[{}:", spelled.join(":"))
        })
        .collect();
    // …and the rendering in which the constrained tail compressed away. The
    // boundary group's range starts at its low value, so "can be zero" is the
    // same test for a fixed group and for a ranged one.
    if let Some(index) = (1..=last).find(|&index| groups[index] == 0) {
        filters.push(format!("{AUTHORITY}\\[{}::", head[..index].join(":")));
    }
    filters
}

#[cfg(test)]
#[path = "ai_content_rules_cidr6.test.rs"]
mod tests;
