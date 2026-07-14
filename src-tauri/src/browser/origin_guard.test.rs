//! WI-2.1 — Rust origin guard: canonicalization + grant matching (R4/I3/R7a).
//!
//! These cases MIRROR `src/lib/browser/origin/originGuard.test.ts`. The TS layer
//! is the specification; this suite is the proof the driver cannot drift from it.
//! A divergence here is a security bug, not a cosmetic one.

use super::*;

fn origin(url: &str) -> Option<CanonicalOrigin> {
    canonicalize_origin(url)
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

#[test]
fn canonicalizes_scheme_host_port() {
    let o = origin("https://Example.COM/path?q=1#frag").expect("navigable");
    assert_eq!(o.scheme, "https");
    assert_eq!(o.host, "example.com");
    assert_eq!(o.port, 443);
}

#[test]
fn fills_in_default_ports() {
    assert_eq!(origin("https://a.com").unwrap().port, 443);
    assert_eq!(origin("http://a.com").unwrap().port, 80);
}

#[test]
fn keeps_explicit_non_default_port() {
    assert_eq!(origin("https://a.com:8443").unwrap().port, 8443);
}

#[test]
fn normalizes_explicit_default_port_to_the_same_origin() {
    assert_eq!(origin("https://a.com:443"), origin("https://a.com"));
    assert_eq!(origin("http://a.com:80"), origin("http://a.com"));
}

#[test]
fn strips_trailing_dot_from_host() {
    assert_eq!(origin("https://example.com.").unwrap().host, "example.com");
}

#[test]
fn punycodes_idn_hosts() {
    // The classic homograph vector: an IDN must canonicalize to punycode so a
    // Unicode look-alike can never match an ASCII grant by string equality.
    assert_eq!(
        origin("https://bücher.de").unwrap().host,
        "xn--bcher-kva.de"
    );
    assert_eq!(origin("https://日本.jp").unwrap().host, "xn--wgv71a.jp");
}

#[test]
fn discards_userinfo() {
    // `https://user:pass@evil.com` must canonicalize to evil.com — never to `user`.
    let o = origin("https://user:pass@evil.com").expect("navigable");
    assert_eq!(o.host, "evil.com");
}

#[test]
fn rejects_opaque_and_non_web_schemes() {
    for url in [
        "about:blank",
        "data:text/html,<h1>x",
        "blob:https://a.com/uuid",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "ws://a.com",
        "wss://a.com",
        "ftp://a.com",
    ] {
        assert!(
            origin(url).is_none(),
            "{url} must not be a navigable origin"
        );
    }
}

#[test]
fn rejects_unparseable_or_hostless_urls() {
    for url in ["", "   ", "not a url", "https://"] {
        assert!(origin(url).is_none(), "{url} must not canonicalize");
    }
}

#[test]
fn matches_whatwg_extra_slash_handling_exactly_like_the_ts_layer() {
    // WHATWG "special authority ignore slashes": `https:///path` parses with the
    // first path segment as the HOST in both `new URL()` and the `url` crate
    // (verified against node). Parity is the security property — the driver must
    // never resolve an origin differently from the layer that granted it, so this
    // asserts the shared interpretation rather than a hand-picked rejection.
    let o = origin("https:///path").expect("WHATWG resolves the host to `path`");
    assert_eq!(o.host, "path");
    assert_eq!(o.port, 443);
}

#[test]
fn rejects_empty_host_labels() {
    for url in ["https://..", "https://.com", "https://a..b.com"] {
        assert!(origin(url).is_none(), "{url} has an empty label");
    }
}

#[test]
fn accepts_ipv6_literal() {
    let o = origin("https://[::1]:8443").expect("navigable");
    assert_eq!(o.host, "[::1]");
    assert_eq!(o.port, 8443);
}

#[test]
fn origin_key_is_scheme_host_port() {
    let o = origin("https://a.com:8443").unwrap();
    assert_eq!(origin_key(&o), "https://a.com:8443");
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

#[test]
fn exact_pattern_matches_only_that_origin() {
    assert!(is_origin_granted(
        "https://a.com/x",
        &["https://a.com".into()]
    ));
    assert!(!is_origin_granted(
        "https://b.com/x",
        &["https://a.com".into()]
    ));
}

#[test]
fn scheme_and_port_must_match_exactly() {
    assert!(!is_origin_granted(
        "http://a.com",
        &["https://a.com".into()]
    ));
    assert!(!is_origin_granted(
        "https://a.com:8443",
        &["https://a.com".into()]
    ));
    assert!(is_origin_granted(
        "https://a.com:8443",
        &["https://a.com:8443".into()]
    ));
}

#[test]
fn no_implicit_subdomain_wildcarding() {
    // R4: a grant for the apex must NOT cover subdomains.
    assert!(!is_origin_granted(
        "https://evil.a.com",
        &["https://a.com".into()]
    ));
}

#[test]
fn explicit_wildcard_covers_strict_subdomains_at_any_depth() {
    let g = vec!["https://*.a.com".to_string()];
    assert!(is_origin_granted("https://x.a.com", &g));
    assert!(is_origin_granted("https://deep.nested.a.com", &g));
}

#[test]
fn wildcard_does_not_cover_the_apex() {
    assert!(!is_origin_granted(
        "https://a.com",
        &["https://*.a.com".into()]
    ));
}

#[test]
fn wildcard_does_not_cover_lookalike_suffixes() {
    // `evil-a.com` and `xa.com` end with "a.com" as a STRING but are not subdomains.
    let g = vec!["https://*.a.com".to_string()];
    assert!(!is_origin_granted("https://evil-a.com", &g));
    assert!(!is_origin_granted("https://xa.com", &g));
    assert!(!is_origin_granted("https://nota.com", &g));
}

#[test]
fn malformed_patterns_grant_nothing() {
    for pattern in [
        "",
        "   ",
        "*",
        "https://*",
        "https://ex*ample.com",
        "https://*.",
        "not-a-url",
        "about:blank",
    ] {
        assert!(
            !is_origin_granted("https://a.com", &[pattern.to_string()]),
            "pattern {pattern:?} must grant nothing"
        );
    }
}

#[test]
fn pattern_with_userinfo_is_rejected_not_reinterpreted() {
    // SECURITY: `https://*.example.com@evil.com` parses with authority `evil.com`.
    // It must be REJECTED, never silently treated as a grant for either host.
    let g = vec!["https://*.example.com@evil.com".to_string()];
    assert!(!is_origin_granted("https://evil.com", &g));
    assert!(!is_origin_granted("https://x.example.com", &g));
}

#[test]
fn pattern_with_path_query_or_fragment_is_rejected() {
    for pattern in ["https://a.com/path", "https://a.com?q=1", "https://a.com#f"] {
        assert!(
            !is_origin_granted("https://a.com", &[pattern.to_string()]),
            "non-bare pattern {pattern:?} must be rejected"
        );
    }
    // A bare origin with a lone trailing slash IS a bare origin.
    assert!(is_origin_granted(
        "https://a.com",
        &["https://a.com/".into()]
    ));
}

#[test]
fn empty_grant_set_denies_by_default() {
    assert!(!is_origin_granted("https://a.com", &[]));
}

#[test]
fn non_navigable_target_is_never_granted() {
    // Even a wildcard-everything-shaped grant cannot cover an opaque origin.
    assert!(!is_origin_granted(
        "about:blank",
        &["https://*.a.com".into()]
    ));
    assert!(!is_origin_granted(
        "file:///etc/passwd",
        &["https://a.com".into()]
    ));
}

#[test]
fn idn_target_matches_punycode_grant_and_vice_versa() {
    assert!(is_origin_granted(
        "https://bücher.de",
        &["https://xn--bcher-kva.de".into()]
    ));
    assert!(is_origin_granted(
        "https://xn--bcher-kva.de",
        &["https://bücher.de".into()]
    ));
}

#[test]
fn a_unicode_lookalike_does_not_match_an_ascii_grant() {
    // U+0430 CYRILLIC SMALL LETTER A — visually identical to ASCII 'a'.
    assert!(!is_origin_granted(
        "https://\u{0430}pple.com",
        &["https://apple.com".into()]
    ));
}

// ---------------------------------------------------------------------------
// Operation-scoped grants (R5) — the eval gate's actual decision
// ---------------------------------------------------------------------------

fn grants() -> Vec<StandingGrant> {
    vec![StandingGrant {
        origin_pattern: "https://blog.example.com".into(),
        operations: vec!["read".into(), "click".into()],
    }]
}

#[test]
fn grant_allows_only_its_listed_operations_on_its_origin() {
    assert!(is_operation_granted(
        "https://blog.example.com/p",
        "read",
        &grants()
    ));
    assert!(is_operation_granted(
        "https://blog.example.com/p",
        "click",
        &grants()
    ));
    // Operation not in the grant.
    assert!(!is_operation_granted(
        "https://blog.example.com/p",
        "publish",
        &grants()
    ));
    // Right operation, wrong origin.
    assert!(!is_operation_granted("https://evil.com", "read", &grants()));
}

#[test]
fn upload_is_never_automatable_even_with_a_matching_grant() {
    // Mirrors NEVER_AUTOMATED in lib/browser/approval/grants.ts — an AI-chosen
    // upload is an exfiltration path, so no grant can authorize it.
    let g = vec![StandingGrant {
        origin_pattern: "https://blog.example.com".into(),
        operations: vec!["read".into(), "upload".into()],
    }];
    assert!(!is_operation_granted(
        "https://blog.example.com",
        "upload",
        &g
    ));
}

#[test]
fn no_grants_denies_every_operation() {
    assert!(!is_operation_granted("https://a.com", "read", &[]));
}

// ---------------------------------------------------------------------------
// Navigation-target validation (replaces the hand-rolled prefix parser)
// ---------------------------------------------------------------------------

#[test]
fn accepts_well_formed_http_and_https_targets() {
    assert!(validate_navigation_url("https://example.com").is_ok());
    assert!(validate_navigation_url("http://example.com/a?b#c").is_ok());
    assert!(validate_navigation_url("  https://example.com  ").is_ok());
    assert!(validate_navigation_url("HTTPS://EXAMPLE.COM").is_ok());
}

#[test]
fn rejects_malformed_targets_the_old_prefix_parser_accepted() {
    // Every one of these passed the previous `starts_with("https://")` + non-empty
    // authority check (audit finding, registry.rs:198).
    for url in [
        "https://@",
        "https://:443",
        "https://exa mple.com",
        "https://",
        "https://.",
        "https://..",
    ] {
        assert!(
            validate_navigation_url(url).is_err(),
            "{url} must be rejected as a navigation target"
        );
    }
}

#[test]
fn rejects_empty_authority_as_a_navigation_target() {
    // WHATWG would reinterpret the first path segment as the host; a navigation
    // target with an empty authority is never what the caller meant. The origin
    // CANONICALIZER stays WHATWG-faithful (parity with TS) — only this gate is
    // stricter. See validate_navigation_url's doc comment.
    assert!(validate_navigation_url("https:///path").is_err());
    assert!(validate_navigation_url("http:///path").is_err());
    assert_eq!(canonicalize_origin("https:///path").unwrap().host, "path");
}

#[test]
fn rejects_non_web_schemes_as_navigation_targets() {
    for url in [
        "javascript:alert(1)",
        "data:text/html,<h1>x",
        "file:///etc/passwd",
        "about:blank",
        "blob:https://a.com/u",
    ] {
        assert!(
            validate_navigation_url(url).is_err(),
            "{url} must be rejected"
        );
    }
}

// ---------------------------------------------------------------------------
// The driver's actual policy decision (R7a per-tab read grant + R4/R5 grants)
// ---------------------------------------------------------------------------

#[test]
fn read_is_allowed_on_any_committed_page_without_a_standing_grant() {
    // R7a: "Reading a page the *user themselves* navigated to is granted per-tab."
    // This holds because the AI has NO navigate tool — the committed origin is
    // always a page the human (or an already-approved act) put there.
    assert!(is_driver_operation_allowed(
        "https://anything.com/p",
        "read",
        &[]
    ));
}

#[test]
fn read_is_still_refused_on_a_non_navigable_committed_origin() {
    assert!(!is_driver_operation_allowed("about:blank", "read", &[]));
    assert!(!is_driver_operation_allowed(
        "file:///etc/passwd",
        "read",
        &[]
    ));
}

#[test]
fn write_operations_require_an_explicit_standing_grant() {
    // The read grant must NOT leak into write authority — this is the whole point
    // of operation-scoped grants ("read my blog" never becomes "publish to it").
    assert!(!is_driver_operation_allowed(
        "https://blog.example.com",
        "click",
        &[]
    ));
    assert!(!is_driver_operation_allowed(
        "https://blog.example.com",
        "type",
        &[]
    ));

    let g = vec![StandingGrant {
        origin_pattern: "https://blog.example.com".into(),
        operations: vec!["click".into()],
    }];
    assert!(is_driver_operation_allowed(
        "https://blog.example.com",
        "click",
        &g
    ));
    // Granted click does not confer type.
    assert!(!is_driver_operation_allowed(
        "https://blog.example.com",
        "type",
        &g
    ));
    // Granted on this origin does not confer authority elsewhere.
    assert!(!is_driver_operation_allowed(
        "https://evil.com",
        "click",
        &g
    ));
}

#[test]
fn upload_is_refused_even_on_a_committed_granted_origin() {
    let g = vec![StandingGrant {
        origin_pattern: "https://blog.example.com".into(),
        operations: vec!["read".into(), "click".into(), "upload".into()],
    }];
    assert!(!is_driver_operation_allowed(
        "https://blog.example.com",
        "upload",
        &g
    ));
}

// ---------------------------------------------------------------------------
// R2 audit — trailing-dot parity, closed operation vocabulary, nav-gate rigor
// ---------------------------------------------------------------------------

#[test]
fn rejects_multiple_trailing_dots_exactly_like_the_ts_layer() {
    // `new URL("https://example.com..").hostname` keeps BOTH dots; the TS guard
    // strips exactly ONE (`replace(/\.$/,"")`) → "example.com." → empty label →
    // rejected. Stripping *every* trailing dot (the old Rust behaviour) collapsed
    // "example.com.." to "example.com" and would match that origin's grant — the
    // precise authorization divergence this module calls a security bug.
    assert!(origin("https://example.com..").is_none());
    assert!(origin("https://a.com...").is_none());
    assert!(origin("https://1.2.3.4..").is_none());
    // A single trailing dot (a rooted FQDN) still canonicalizes to the bare host.
    assert_eq!(origin("https://example.com.").unwrap().host, "example.com");
}

#[test]
fn multiple_trailing_dots_grant_nothing_on_target_or_pattern() {
    // Neither a target nor a pattern carrying 2+ trailing dots may authorize.
    assert!(!is_origin_granted(
        "https://example.com..",
        &["https://example.com".into()]
    ));
    assert!(!is_origin_granted(
        "https://example.com",
        &["https://example.com..".into()]
    ));
}

#[test]
fn unknown_and_case_variant_operations_are_denied_like_the_ts_vocabulary() {
    // Parity with `isBrowserOperation` in lib/browser/approval/grants.ts: the
    // operation vocabulary is CLOSED. A case-variant like "Upload" must not slip
    // past the lowercase-only hard denial even when a malformed grant lists it —
    // that is exactly how a grant bypasses the `upload` hard-deny.
    let g = vec![StandingGrant {
        origin_pattern: "https://blog.example.com".into(),
        operations: vec![
            "Upload".into(),
            "Read".into(),
            "frobnicate".into(),
            "click".into(),
        ],
    }];
    for op in ["Upload", "Read", "frobnicate", "CLICK", "read ", ""] {
        assert!(
            !is_driver_operation_allowed("https://blog.example.com", op, &g),
            "unknown/variant operation {op:?} must be denied by the driver gate"
        );
        assert!(
            !is_operation_granted("https://blog.example.com", op, &g),
            "unknown/variant operation {op:?} must not be granted"
        );
    }
    // The canonical lowercase spellings still behave exactly as before.
    assert!(is_driver_operation_allowed(
        "https://blog.example.com",
        "read",
        &g
    ));
    assert!(is_operation_granted(
        "https://blog.example.com",
        "click",
        &g
    ));
}

#[test]
fn rejects_shorthand_and_backslash_authority_forms_as_nav_targets() {
    // WHATWG folds every one of these to `https://path/`; the previously shipped
    // gate, which only looked for `://` followed by a slash, waved them through.
    // The nav gate promises an explicit, well-formed http(s) URL, so each is
    // refused rather than silently reinterpreted.
    for url in [
        "https:/path",
        "https:path",
        "https:\\path",
        "https://\\path",
        "https://path\\x",
        "HTTPS:/path",
    ] {
        assert!(
            validate_navigation_url(url).is_err(),
            "{url} must be rejected as a navigation target"
        );
    }
    // Ordinary well-formed targets (incl. uppercase scheme) still pass.
    assert!(validate_navigation_url("https://example.com").is_ok());
    assert!(validate_navigation_url("HTTPS://EXAMPLE.COM/a?b#c").is_ok());
}

