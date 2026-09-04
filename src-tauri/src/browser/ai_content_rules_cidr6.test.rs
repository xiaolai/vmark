//! Audit 20260903 round 3, #9 — the IPv6 filter derivation: WebKit's rendering,
//! the shapes the table actually holds, and the preconditions that make the
//! derivation exact.

use super::*;
use crate::browser::ai_policy_addr::{BLOCKED_IPV6_RANGES, IPV6_LOOPBACK};

fn v6(text: &str) -> Ipv6Addr {
    text.parse().expect("an IPv6 literal")
}

#[test]
fn render_is_the_url_standards_serializer_not_rusts_display() {
    // Rust prints the dotted v4 form for an IPv4-MAPPED address; WebKit and the
    // URL Standard never do — a probe built with `Display` would test a URL
    // WebKit cannot produce.
    assert_eq!(render(v6("::ffff:7f00:1")), "::ffff:7f00:1");
    assert_eq!(
        format!("{}", v6("::ffff:7f00:1")),
        "::ffff:127.0.0.1",
        "the trap this avoids"
    );
    assert_eq!(render(v6("::2")), "::2");
    // Compression: the FIRST LONGEST run of two or more zero groups.
    assert_eq!(render(v6("::")), "::");
    assert_eq!(render(v6("::1")), "::1");
    assert_eq!(render(v6("fe80::")), "fe80::");
    assert_eq!(render(v6("2001:db8::1")), "2001:db8::1");
    assert_eq!(
        render(v6("2001:0:0:1:0:0:0:1")),
        "2001:0:0:1::1",
        "the later, longer run"
    );
    assert_eq!(
        render(v6("2001:0:0:1:0:0:1:1")),
        "2001::1:0:0:1:1",
        "leftmost on a tie"
    );
    assert_eq!(
        render(v6("1:2:0:3:4:5:6:7")),
        "1:2:0:3:4:5:6:7",
        "a single zero group is never compressed"
    );
    // Leading zeros are stripped per group, and hex is lowercase.
    assert_eq!(
        render(v6("2001:0DB8:0000:0000:0000:0000:0000:00AB")),
        "2001:db8::ab"
    );
}

#[test]
fn a_single_address_matches_whole_up_to_the_bracket() {
    let filters = bracket_filters(v6("::1"), 128);
    assert_eq!(filters.len(), 1);
    assert!(filters[0].ends_with("\\[::1\\]"), "{}", filters[0]);
    assert!(bracket_filters(v6("::"), 128)[0].ends_with("\\[::\\]"));
}

#[test]
fn a_range_inside_the_first_group_becomes_hex_classes_ended_by_a_colon() {
    let filters = bracket_filters(v6("fc00::"), 7);
    assert_eq!(
        filters,
        vec![format!("{AUTHORITY}\\[f[c-d][0-9a-f][0-9a-f]:")]
    );
    assert_eq!(
        bracket_filters(v6("fe80::"), 10),
        vec![format!("{AUTHORITY}\\[fe[8-9a-b][0-9a-f]:")]
    );
}

#[test]
fn a_fixed_prefix_spells_its_groups_and_stops_at_the_constrained_one() {
    assert_eq!(
        bracket_filters(v6("2001:db8::"), 32),
        vec![format!("{AUTHORITY}\\[2001:db8:")],
        "no zero group, so one rendering"
    );
    assert_eq!(
        bracket_filters(v6("2001:10::"), 28),
        vec![format!("{AUTHORITY}\\[2001:1[0-9a-f]:")]
    );
}

#[test]
fn a_zero_constrained_group_emits_both_of_its_renderings() {
    // The group written out, and the group compressed away.
    assert_eq!(
        bracket_filters(v6("2001::"), 32),
        vec![
            format!("{AUTHORITY}\\[2001:0:"),
            format!("{AUTHORITY}\\[2001::"),
        ]
    );
    assert_eq!(
        bracket_filters(v6("2001:2::"), 48),
        vec![
            format!("{AUTHORITY}\\[2001:2:0:"),
            format!("{AUTHORITY}\\[2001:2::"),
        ],
        "narrower than a bare `2001:2:` prefix, which also matched 2001:2:5::"
    );
}

#[test]
fn every_blocked_range_has_a_shape_the_derivation_expresses_exactly() {
    // The module doc's three preconditions, checked against the real table so a
    // range of an unexpressible shape fails HERE — with the reason — rather than
    // as a mysterious parity mismatch.
    for &(network, prefix) in BLOCKED_IPV6_RANGES
        .iter()
        .chain(std::iter::once(&IPV6_LOOPBACK))
    {
        if prefix >= 128 {
            continue; // a single address renders exactly one way
        }
        let groups = network.segments();
        let rest = prefix % 16;
        let last = if rest == 0 {
            usize::from(prefix / 16).saturating_sub(1)
        } else {
            usize::from(prefix / 16)
        };
        assert_ne!(
            groups[0], 0,
            "{network}/{prefix}: an address compressing from group 0 carries no prefix to key on"
        );
        if rest != 0 {
            assert_ne!(
                groups[last], 0,
                "{network}/{prefix}: a boundary group whose range includes zero has two renderings per value"
            );
        }
        if let Some(zero) = (1..=last).find(|&index| groups[index] == 0) {
            assert!(
                groups[zero..=last].iter().all(|group| *group == 0),
                "{network}/{prefix}: a zero constrained group must be followed only by zeros"
            );
        }
    }
}
