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
#[path = "ai_content_rules_cidr.rs"]
mod cidr;
#[path = "ai_content_rules_cidr6.rs"]
mod cidr6;

use super::ai_policy_addr::{
    BLOCKED_IPV4_RANGES, BLOCKED_IPV6_RANGES, IPV4_LOOPBACK, IPV6_LOOPBACK,
};

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

/// A mapped (`[::ffff:g1:g2]`) or compatible (`[::g1:g2]`) IPv6 literal whose two
/// low 16-bit groups match `g1` and `g2` — the hex spelling WebKit gives a /24 (or
/// narrower) IPv4 range, where the FIRST group alone is not selective enough.
fn ipv6_embedded(mapped: bool, g1: &str, g2: &str) -> String {
    let head = if mapped { "::ffff:" } else { "::" };
    format!("{AUTHORITY}\\[{head}{g1}:{g2}\\]")
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
    // Dotted-decimal spellings of every range the navigation policy refuses, DERIVED
    // from its table (`BLOCKED_IPV4_RANGES`) so the two cannot drift: the first
    // hand-written list lacked six of them, and a page could still fetch from
    // those ranges as subresources while navigation refused them.
    let mut filters: Vec<String> = BLOCKED_IPV4_RANGES
        .iter()
        .flat_map(|&(network, prefix)| cidr::dotted_filters(network, prefix))
        .collect();
    // …and their hex-embedded IPv6 spellings. A /24 is one value of the high
    // group plus the high byte of the low group; WebKit strips leading zeros per
    // group, so 192.0.0.x is `c000:x` (1–2 hex digits) and 192.0.2.x is `c000:2xx`.
    for mapped in [true, false] {
        filters.push(ipv6_embedded(mapped, "c000", "[0-9a-f]?[0-9a-f]"));
        filters.push(ipv6_embedded(mapped, "c000", "2[0-9a-f][0-9a-f]"));
        filters.push(ipv6_embedded(mapped, "c058", "63[0-9a-f][0-9a-f]"));
        filters.push(ipv6_embedded(mapped, "c633", "64[0-9a-f][0-9a-f]"));
        filters.push(ipv6_embedded(mapped, "cb00", "71[0-9a-f][0-9a-f]"));
    }
    // 198.18.0.0/15 is a whole high group: `c612` or `c613`, any low group.
    filters.push(ipv6_prefix("::ffff:c61[23]:"));
    filters.push(ipv6_prefix("::c61[23]:"));
    // Mapped (`::ffff:a.b.c.d`) and compatible (`::a.b.c.d`) forms of the
    // private IPv4 ranges above, one rule per hex group pattern.
    for hex in V4_HEX_ALWAYS.iter().chain([V4_HEX_HIGH_MAPPED].iter()) {
        filters.push(ipv6_prefix(&format!("::ffff:{hex}:")));
    }
    for hex in V4_HEX_ALWAYS.iter().chain(V4_HEX_HIGH_COMPATIBLE.iter()) {
        filters.push(ipv6_prefix(&format!("::{hex}:")));
    }
    // `[::<group>]` — the compatible form of 0.0.x.y, the one 0/8 spelling that
    // ENDS the address instead of continuing with a `:`. Every such address is in
    // 0/8, so all of them block; `::1` is the exception, being loopback, and is
    // spelled out of the single-digit class so the loopback opt-in still reaches
    // it (the whole-address `[::1]` filter is derived below when loopback is
    // blocked). `[::ffff]` used to be the only member of this shape the list
    // carried — 0.0.255.255 alone, with `[::2]` reachable.
    filters.push(ipv6_prefix("::[0-9a-f][0-9a-f]+\\]"));
    filters.push(ipv6_prefix("::[02-9a-f]\\]"));
    // `[::ffff:xxxx]` — compatible 255.255.0.0/16 (inside 240/4). Exactly ONE group
    // after `ffff` and then the bracket: a mapped address always carries a further
    // `:group`, so this cannot swallow `[::ffff:808:808]` the way an unanchored
    // `ffff` in the compatible list would. Found by the policy-parity test.
    filters.push(ipv6_embedded(false, "ffff", "[0-9a-f]+"));
    // The NATIVE v6 ranges, DERIVED from the navigation policy's table exactly as
    // the dotted-decimal rules are derived from its IPv4 one (round 3, #9): the
    // unspecified address, the ULA / link-local / site-local / multicast blocks,
    // and the documentation, Teredo, benchmarking and ORCHID prefixes all come
    // from `BLOCKED_IPV6_RANGES`, so a range added to the policy is blocked for
    // subresources too, with no second list to forget.
    filters.extend(
        BLOCKED_IPV6_RANGES
            .iter()
            .flat_map(|&(network, prefix)| cidr6::bracket_filters(network, prefix)),
    );
    filters.extend([
        // Transition prefixes, wholesale (see the module doc). NOT in the table:
        // the validator judges them by the IPv4 address they embed, and a DFA
        // cannot range-check that, so the rule list is stricter here on purpose.
        ipv6_prefix("64:ff9b:"),
        ipv6_prefix("2002:"),
    ]);
    // Cloud metadata names and the LAN-facing suffixes (`.local`, `home.arpa`,
    // `.internal`), apex included.
    filters.extend(each(&["metadata", "instance-data"], hostname));
    filters.extend(each(&["local", "home\\.arpa", "internal"], |suffix| {
        hostname(&format!("([^/?#@]*\\.)?{suffix}"))
    }));
    if !allow_loopback {
        filters.extend(cidr::dotted_filters(IPV4_LOOPBACK.0, IPV4_LOOPBACK.1));
        filters.extend(cidr6::bracket_filters(IPV6_LOOPBACK.0, IPV6_LOOPBACK.1));
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
