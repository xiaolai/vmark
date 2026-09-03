//! The AI tab's destination policy as a WebKit content rule list (audit 20260903 P-01).
//!
//! `validate_ai_navigation_url` is consulted by the navigation delegate, and the
//! delegate only sees NAVIGATIONS: the main frame's and (since P-01) each
//! subframe's. It never sees a subresource — an `<img>`, a stylesheet, a
//! `fetch()`, a WebSocket — so a public page the AI opened with zero approval
//! could still make the WebKit process reach link-local, LAN or cloud-metadata
//! addresses, blind (a cross-origin body is unreadable) but real. A
//! `WKContentRuleList` is evaluated by WebKit for EVERY load the webview makes,
//! in every frame, before the request leaves the machine, so it closes the class
//! the delegate structurally cannot.
//!
//! This module is the pure half: it generates the rule-list JSON, and is tested
//! with the `regex` crate against a table of URLs that must and must not be
//! blocked. `content_rules_macos.rs` compiles it with `WKContentRuleListStore`
//! and attaches it to AI-owned webviews at configuration time.
//!
//! **The regex dialect is WebKit's, which is a subset — and it was MEASURED, not
//! read off a reference.** A `WKContentRuleListStore` probe compiled one rule per
//! construct: `.`, `*`, `+`, `?`, `[a-z]` / `[^a-z]` classes, `( )` groups
//! (including `( )?`), `\.` / `\[` escapes and the `^` / `$` anchors compile.
//! `a|b` is refused — "Disjunctions are not supported yet." — and so is `a{2}`
//! ("Arbitrary atom repetitions are not supported."); `\d`, lookaround,
//! backreferences and lazy quantifiers are outside the grammar too. The first
//! draft of this list carried `|` in nine filters because the `regex` crate
//! accepted them; WebKit refused the whole list, and every AI `open` failed with
//! `CONTENT_RULES_FAILED`. Alternation is therefore spelled as SEPARATE RULES:
//! a rule list is already a union, so N block rules say exactly what one
//! pattern with N alternatives would. The test lints every filter for the
//! refused constructs, so a pattern the `regex` crate accepts but WebKit would
//! not fails the unit test rather than the first AI tab creation.
//!
//! Filters match the URL as WebKit SERIALIZES it, which is what makes a small
//! set of patterns sufficient: hosts are lowercased, IPv4 legacy spellings
//! (`2130706433`, `0x7f.1`, `127.1`) are canonicalized to dotted quads and IPv6
//! literals to their compressed bracketed hex form before any rule sees them.
//! The transition prefixes (6to4 `2002::/16`, NAT64 `64:ff9b::/96`) are blocked
//! WHOLESALE rather than by their embedded IPv4 range: a DFA cannot range-check
//! an address hidden in hex, and no legitimate destination for an AI-driven load
//! is reachable only through a transition-prefix literal — every public IPv4
//! host has a plain IPv4 spelling. That makes this list stricter than the
//! navigation validator in exactly that direction, never looser.
//!
//! @coordinates-with browser/ai_policy.rs — the validator these rules mirror
//! @coordinates-with browser/content_rules_macos.rs — compiles and installs the list

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// `scheme://` then an optional `user:pass@`. `[^:/]+` is the scheme; the
/// userinfo class excludes every delimiter that ends the authority, so a `@` in
/// a path or query can never pull a later host into the match.
const AUTHORITY: &str = "^[^:/]+://([^/?#@]*@)?";

/// What follows a hostname: an optional trailing dot, an optional port, then the
/// delimiter that ends the host. Anchoring on the delimiter is what keeps
/// `127.0.0.1.example.com` (a domain) from matching the loopback rule.
const HOST_END: &str = r"\.?(:[0-9]+)?[/?#]";

/// A dotted-quad octet. WebKit canonicalizes legacy IPv4 spellings before
/// matching, so the DOTTED form is the only one a rule ever sees.
const OCTET: &str = "[0-9]+";

/// The 16-bit hex group a private IPv4 range becomes inside a mapped
/// (`::ffff:a.b.c.d`) or compatible (`::a.b.c.d`) IPv6 literal — WebKit
/// serializes both as hex (`[::ffff:7f00:1]`).
const V4_HEX_ALWAYS: &[&str] = &[
    "a[0-9a-f][0-9a-f]", // 10.0.0.0/8
    "ac1[0-9a-f]",       // 172.16.0.0/12
    "c0a8",              // 192.168.0.0/16
    "a9fe",              // 169.254.0.0/16
    "64[4-7][0-9a-f]",   // 100.64.0.0/10
    "[0-9a-f]?[0-9a-f]", // 0.0.0.0/8
];
/// 224.0.0.0/4 and 240.0.0.0/4 — `e000` through `ffff` — in the MAPPED form,
/// where the `ffff:` prefix has already been consumed.
const V4_HEX_HIGH_MAPPED: &str = "[ef][0-9a-f][0-9a-f][0-9a-f]";
/// The same range in the COMPATIBLE form, minus `ffff` itself: there the group
/// sits right after `::`, and a pattern admitting `ffff` would swallow every
/// mapped address, public ones included (`[::ffff:808:808]` is 8.8.8.8).
const V4_HEX_HIGH_COMPATIBLE: &[&str] = &[
    "e[0-9a-f][0-9a-f][0-9a-f]",
    "f[0-9a-e][0-9a-f][0-9a-f]",
    "ff[0-9a-e][0-9a-f]",
    "fff[0-9a-e]",
];
const V4_HEX_LOOPBACK: &str = "7f[0-9a-f][0-9a-f]"; // 127.0.0.0/8

fn ipv4(first: &str) -> String {
    format!("{AUTHORITY}{first}\\.{OCTET}\\.{OCTET}\\.{OCTET}{HOST_END}")
}

fn ipv4_two(first: &str, second: &str) -> String {
    format!("{AUTHORITY}{first}\\.{second}\\.{OCTET}\\.{OCTET}{HOST_END}")
}

/// A bracketed IPv6 literal whose text begins with `prefix` (already in
/// WebKit's compressed lowercase form). The rule matches the URL's prefix only:
/// a url-filter is a search, so nothing after the address needs to be spelled.
fn ipv6_prefix(prefix: &str) -> String {
    format!("{AUTHORITY}\\[{prefix}")
}

fn hostname(pattern: &str) -> String {
    format!("{AUTHORITY}{pattern}{HOST_END}")
}

/// One filter per alternative. WebKit's url-filter has no `|`, and a rule list
/// is a union: N block rules with one action are the alternation.
fn each(alternatives: &[&str], make: impl Fn(&str) -> String) -> Vec<String> {
    alternatives.iter().map(|alt| make(alt)).collect()
}

/// Every url-filter in the list, in order. Exposed for the tests, which compile
/// each one with the `regex` crate and run the URL table against it.
pub fn url_filters(allow_loopback: bool) -> Vec<String> {
    let mut filters = vec![ipv4("10")];
    // 172.16.0.0/12
    filters.extend(each(&["1[6-9]", "2[0-9]", "3[01]"], |second| {
        ipv4_two("172", second)
    }));
    filters.push(ipv4_two("192", "168"));
    filters.push(ipv4_two("169", "254"));
    // 100.64.0.0/10
    filters.extend(each(
        &["6[4-9]", "[7-9][0-9]", "1[01][0-9]", "12[0-7]"],
        |second| ipv4_two("100", second),
    ));
    filters.push(ipv4("0"));
    // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved.
    filters.extend(each(&["22[4-9]", "23[0-9]", "24[0-9]", "25[0-5]"], ipv4));
    // `[::]` — unspecified.
    filters.push(ipv6_prefix("::\\]"));
    // Mapped (`::ffff:a.b.c.d`) and compatible (`::a.b.c.d`) forms of the
    // private IPv4 ranges above, one rule per hex group pattern.
    for hex in V4_HEX_ALWAYS.iter().chain([V4_HEX_HIGH_MAPPED].iter()) {
        filters.push(ipv6_prefix(&format!("::ffff:{hex}:")));
    }
    for hex in V4_HEX_ALWAYS.iter().chain(V4_HEX_HIGH_COMPATIBLE.iter()) {
        filters.push(ipv6_prefix(&format!("::{hex}:")));
    }
    // `[::ffff]` — compatible 0.0.255.255, the one 0/8 spelling that ends the
    // address instead of continuing with a `:`.
    filters.push(ipv6_prefix("::ffff\\]"));
    filters.extend([
        // Transition prefixes, wholesale (see the module doc).
        ipv6_prefix("64:ff9b:"),
        ipv6_prefix("2002:"),
        // fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local.
        ipv6_prefix("f[cd][0-9a-f][0-9a-f]:"),
        ipv6_prefix("fe[89ab][0-9a-f]:"),
        ipv6_prefix("fe[c-f][0-9a-f]:"),
        // ff00::/8 multicast.
        ipv6_prefix("ff[0-9a-f][0-9a-f]:"),
        // 2001:db8::/32 documentation, 2001::/32 Teredo, 2001:2::/48 benchmark,
        // 2001:10::/28 ORCHID — what the validator refuses, spelled as WebKit does.
        ipv6_prefix("2001:db8:"),
        ipv6_prefix("2001::"),
        ipv6_prefix("2001:0:"),
        ipv6_prefix("2001:2:"),
        ipv6_prefix("2001:1[0-9a-f]:"),
    ]);
    // Cloud metadata names and the LAN-facing suffixes (`.local`, `home.arpa`,
    // `.internal`), apex included.
    filters.extend(each(&["metadata", "instance-data"], hostname));
    filters.extend(each(&["local", "home\\.arpa", "internal"], |suffix| {
        hostname(&format!("([^/?#@]*\\.)?{suffix}"))
    }));
    if !allow_loopback {
        filters.push(ipv4("127"));
        filters.push(ipv6_prefix("::1\\]"));
        filters.push(ipv6_prefix(&format!("::(ffff:)?{V4_HEX_LOOPBACK}:")));
        filters.push(hostname("([^/?#@]*\\.)?localhost"));
    }
    filters
}

/// The encoded content rule list: one `block` rule per filter, every resource
/// type (no `resource-type` trigger, so documents, subframes, scripts, images,
/// fetches and sockets are all covered), case-insensitive by WebKit's default.
pub fn rules_json(allow_loopback: bool) -> String {
    let rules: Vec<Value> = url_filters(allow_loopback)
        .into_iter()
        .map(|filter| {
            json!({
                "trigger": { "url-filter": filter },
                "action": { "type": "block" },
            })
        })
        .collect();
    serde_json::to_string(&Value::Array(rules)).expect("a JSON array of objects serializes")
}

/// The identifier the compiled list is stored under. It embeds a digest of the
/// rules, so a rule change can never resolve to a list compiled from older rules
/// — the store keys compiled lists by this string.
pub fn identifier(allow_loopback: bool) -> String {
    let digest = Sha256::digest(rules_json(allow_loopback).as_bytes());
    let short: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    let loopback = if allow_loopback {
        "loopback-allowed"
    } else {
        "loopback-blocked"
    };
    format!("vmark.ai-destination-policy.{loopback}.{short}")
}

#[cfg(test)]
#[path = "ai_content_rules.test.rs"]
mod tests;
