//! Audit 20260903 P-01 — the content rule list that refuses private-network loads
//! the navigation delegate cannot see (subframes are policy-checked too, but
//! subresources — images, scripts, fetches, sockets — only meet this list).
//!
//! The filters are compiled here with the `regex` crate, which is a superset of
//! WebKit's url-filter dialect; a separate test lints them down to the subset, so
//! "compiles under `regex`" plus "uses no forbidden construct" is the contract.

use super::*;
use regex::Regex;

/// Compile every filter the way WebKit evaluates it: case-insensitive by default.
fn compiled(allow_loopback: bool) -> Vec<Regex> {
    url_filters(allow_loopback)
        .iter()
        .map(|f| Regex::new(&format!("(?i){f}")).unwrap_or_else(|e| panic!("{f}: {e}")))
        .collect()
}

fn blocked(filters: &[Regex], url: &str) -> bool {
    filters.iter().any(|r| r.is_match(url))
}

/// URLs an AI tab must never load, in the spelling WebKit serializes them in.
const MUST_BLOCK: &[&str] = &[
    // Loopback (gated by allow_loopback — see the dedicated test).
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/x",
    "https://127.255.0.1/",
    "http://[::1]/",
    "http://[::1]:3000/",
    "http://[::ffff:7f00:1]/",
    "http://[::7f00:1]/",
    "http://localhost/",
    "http://localhost:5173/",
    "http://app.localhost/",
    "HTTP://LOCALHOST/",
    "http://localhost./",
    // RFC 1918.
    "http://10.0.0.1/a.png",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://user:pw@10.0.0.1/",
    "ws://192.168.0.2:9000/socket",
    // Link-local, CGNAT, 0/8, multicast, reserved.
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://0.0.0.0/",
    "http://0.1.2.3/",
    "http://224.0.0.1/",
    "http://239.255.255.250/",
    "http://240.0.0.1/",
    "http://255.255.255.255/",
    // IPv6: unspecified, mapped/compatible private ranges, transition prefixes,
    // ULA, link-local, site-local, multicast, documentation/Teredo/benchmark/ORCHID.
    "http://[::]/",
    "http://[::ffff:a00:1]/",
    "http://[::ffff:ac10:1]/",
    "http://[::ffff:c0a8:101]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::ffff:6440:1]/",
    "http://[::ffff:0:1]/",
    "http://[::ffff:e000:1]/",
    "http://[::ffff:ffff:ffff]/",
    "http://[::a00:1]/",
    "http://[::e000:1]/",
    "http://[::fffe:1]/",
    "http://[::1:2]/",
    "http://[::ffff]/",
    "http://[64:ff9b::808:808]/",
    "http://[2002:808:808::]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[2001:db8::1]/",
    "http://[2001::1]/",
    "http://[2001:0:1::1]/",
    "http://[2001:2::1]/",
    "http://[2001:10::1]/",
    "http://[2001:1f::1]/",
    // Metadata and LAN-facing names.
    "http://metadata/",
    "http://instance-data/computeMetadata/v1/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://router.home.arpa/",
    "http://ip-10-0-0-1.ec2.internal/",
    "http://local/",
    "http://internal/",
];

/// Public destinations, and look-alikes that must stay reachable.
const MUST_ALLOW: &[&str] = &[
    "https://example.com/",
    "https://example.com/?redirect=http://127.0.0.1/",
    "https://example.com/#http://10.0.0.1/",
    "https://example.com/10.0.0.1/",
    "https://example.com/a@10.0.0.1/",
    "https://127.0.0.1.example.com/",
    "https://10.0.0.1.nip.io/",
    "https://notlocal.com/",
    "https://internal.example.com/",
    "https://localhost.example.com/",
    "https://mylocalhost.com/",
    "https://metadata.example.com/",
    "http://8.8.8.8/",
    "http://11.0.0.1/",
    "http://172.15.0.1/",
    "http://172.32.0.1/",
    "http://192.169.0.1/",
    "http://169.253.0.1/",
    "http://100.63.0.1/",
    "http://100.128.0.1/",
    "http://223.255.255.255/",
    "https://[2001:4860:4860::8888]/",
    "https://[2600::]/",
    "https://[2a00:1450:4001::1]/",
    "https://[::ffff:808:808]/",
    "https://[2001:db9::1]/",
    "https://[2001:20::1]/",
    "https://[fe00::1]/",
    "https://[fb00::1]/",
    "https://[fa00::1]/",
];

#[test]
fn private_destinations_are_blocked_in_every_spelling_webkit_serializes() {
    let filters = compiled(false);
    for url in MUST_BLOCK {
        assert!(blocked(&filters, url), "{url} must be blocked");
    }
}

#[test]
fn public_destinations_and_look_alikes_are_not_blocked() {
    let filters = compiled(false);
    for url in MUST_ALLOW {
        assert!(!blocked(&filters, url), "{url} must stay reachable");
    }
}

#[test]
fn loopback_rules_are_absent_when_loopback_is_allowed_and_nothing_else_opens() {
    let filters = compiled(true);
    for url in [
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://[::ffff:7f00:1]/",
        "http://[::7f00:1]/",
        "http://localhost/",
        "http://app.localhost/",
    ] {
        assert!(!blocked(&filters, url), "{url} is the user's own machine");
    }
    // The toggle means "my own machine", never the LAN (ai_policy.rs).
    for url in [
        "http://10.0.0.1/",
        "http://[::]/",
        "http://169.254.169.254/",
        "http://printer.local/",
        "http://[fe80::1]/",
    ] {
        assert!(blocked(&filters, url), "{url} must stay blocked");
    }
    for url in MUST_ALLOW {
        assert!(!blocked(&filters, url), "{url} must stay reachable");
    }
}

#[test]
fn every_private_range_family_is_present() {
    // Behavioural, per family, so a dropped rule fails by NAME rather than as one
    // entry in a long table.
    let filters = compiled(false);
    let families = [
        ("loopback", "http://127.0.0.1/"),
        ("10/8", "http://10.0.0.1/"),
        ("172.16/12", "http://172.16.0.1/"),
        ("192.168/16", "http://192.168.0.1/"),
        ("link-local", "http://169.254.1.1/"),
        ("cgnat", "http://100.64.0.1/"),
        ("0/8", "http://0.0.0.0/"),
        ("multicast", "http://224.0.0.1/"),
        ("reserved", "http://240.0.0.1/"),
        ("v6 loopback", "http://[::1]/"),
        ("v6 unspecified", "http://[::]/"),
        ("v6 mapped", "http://[::ffff:a00:1]/"),
        ("v6 link-local", "http://[fe80::1]/"),
        ("v6 ula", "http://[fd00::1]/"),
        ("v6 multicast", "http://[ff02::1]/"),
        ("metadata", "http://metadata/"),
        ("localhost", "http://localhost/"),
    ];
    for (family, url) in families {
        assert!(blocked(&filters, url), "{family} family missing ({url})");
    }
}

#[test]
fn the_rule_list_is_valid_json_of_block_actions_for_every_resource_type() {
    for allow_loopback in [false, true] {
        let value: Value = serde_json::from_str(&rules_json(allow_loopback)).expect("valid JSON");
        let rules = value.as_array().expect("a top-level array");
        assert_eq!(rules.len(), url_filters(allow_loopback).len());
        for rule in rules {
            assert_eq!(rule["action"]["type"], "block");
            assert!(rule["trigger"]["url-filter"].is_string());
            // No resource-type trigger: the rule applies to documents, frames,
            // scripts, images, fetches and sockets alike.
            assert!(rule["trigger"].get("resource-type").is_none());
        }
    }
}

#[test]
fn every_filter_stays_inside_webkits_regex_subset() {
    // WebKit's URLFilterParser refuses these outright; a filter using one would
    // fail to compile on the first AI tab creation, not here. `|` is the one
    // that shipped: the `regex` crate accepts a disjunction, WebKit answers
    // "Disjunctions are not supported yet." (measured with a
    // WKContentRuleListStore probe), and the whole list — every AI `open` — died
    // with it. `$` is legal but kept out too: a filter matches the URL's prefix.
    let forbidden = [
        "\\d", "\\w", "\\s", "\\b", "\\D", "\\W", "\\S", "{", "}", "(?", "*?", "+?", "??", "$", "|",
    ];
    for filter in url_filters(false) {
        for construct in forbidden {
            assert!(
                !filter.contains(construct),
                "{filter} uses {construct:?}, which WebKit's url-filter grammar rejects"
            );
        }
        assert!(
            filter.starts_with('^'),
            "{filter} must be anchored at the start"
        );
    }
}

#[test]
fn the_identifier_changes_with_the_policy_and_with_the_rules() {
    let blocked = identifier(false);
    let allowed = identifier(true);
    assert_ne!(blocked, allowed);
    assert!(blocked.contains("loopback-blocked"));
    assert!(allowed.contains("loopback-allowed"));
    // Deterministic: the same rules always name the same compiled list.
    assert_eq!(identifier(false), blocked);
}
