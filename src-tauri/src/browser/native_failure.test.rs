//! Audit 20260903 round 3, #31 — the native failure vocabulary is a closed enum,
//! and every producer's token has exactly one classifier variant.

use super::*;

#[test]
fn every_tagged_class_round_trips_through_its_own_rendering() {
    for class in NativeSurfaceError::TAGGED {
        let with_detail =
            class.tagged("some detail: with a colon, and https://x.test/?e=NO_WEBVIEW");
        assert_eq!(
            NativeSurfaceError::parse(&with_detail),
            class,
            "{with_detail}"
        );
        // The bare form (`PROFILE_STORE_LIMIT` ships without a detail).
        let bare = class.tagged("");
        assert_eq!(NativeSurfaceError::parse(&bare), class, "{bare}");
        assert_eq!(Some(bare.as_str()), class.token());
        // Producers write `TOKEN: detail` — the classifier's delimiter, not a guess.
        assert!(
            with_detail.starts_with(&format!("{}: ", class.token().expect("tagged"))),
            "{with_detail}"
        );
    }
}

#[test]
fn tokens_are_unique_and_the_untagged_class_has_none() {
    let mut tokens: Vec<&str> = NativeSurfaceError::TAGGED
        .iter()
        .map(|class| class.token().expect("every TAGGED class carries a token"))
        .collect();
    tokens.sort_unstable();
    tokens.dedup();
    assert_eq!(
        tokens.len(),
        NativeSurfaceError::TAGGED.len(),
        "two classes share a token"
    );
    assert!(!NativeSurfaceError::TAGGED.contains(&NativeSurfaceError::Untagged));
    assert_eq!(NativeSurfaceError::Untagged.token(), None);
    // An untagged failure renders as its own text — no token is invented for it.
    assert_eq!(
        NativeSurfaceError::Untagged.tagged("plain prose"),
        "plain prose"
    );
}

#[test]
fn a_token_inside_the_message_does_not_classify_it() {
    // The substring-sniff trap WI-14 exists to close: a URL carrying a token in its
    // query string must not be able to relabel its own failure. Matching is anchored
    // at the start AND delimited.
    for message in [
        format!("some prose mentioning {}", fail::WINDOW_GONE),
        format!("{}_SUFFIXED: not the token", fail::NO_WEBVIEW),
        format!("https://x.test/?e={}", fail::INVALID_URL),
        format!("{}x", fail::MAIN_THREAD_TIMEOUT),
        String::new(),
    ] {
        assert_eq!(
            NativeSurfaceError::parse(&message),
            NativeSurfaceError::Untagged,
            "{message:?} was classified by an unanchored match"
        );
    }
}

/// The contract is `surface::fail`, whose constants every producer names — including
/// the producers this module does not own (`surface_view_macos.rs`,
/// `content_rules_macos.rs`, `browser_store_macos.rs`). Read that block from source so
/// a constant added there without a variant here, or a variant whose token no
/// constant names, fails — the producer/classifier drift the string chain allowed.
#[test]
fn every_fail_constant_has_exactly_one_variant_and_vice_versa() {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/browser/surface.rs"
    ))
    .expect("read surface.rs");
    let start = source
        .find("pub mod fail {")
        .expect("surface.rs declares `pub mod fail`");
    let block = &source[start..];
    let end = block.find("\n}\n").expect("the fail block closes");
    let block = &block[..end];
    let re = regex::Regex::new(r#"pub const ([A-Z_]+): &str = "([A-Z_]+)";"#).expect("valid regex");
    let constants: Vec<(String, String)> = re
        .captures_iter(block)
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect();
    assert!(!constants.is_empty(), "no constants found in `mod fail`");
    let tokens: Vec<&str> = NativeSurfaceError::TAGGED
        .iter()
        .filter_map(|class| class.token())
        .collect();
    for (name, wire) in &constants {
        assert_eq!(
            name, wire,
            "fail::{name} must be spelled as its own wire value"
        );
        assert_eq!(
            tokens.iter().filter(|token| *token == wire).count(),
            1,
            "fail::{name} must map to exactly one NativeSurfaceError variant"
        );
    }
    assert_eq!(
        constants.len(),
        tokens.len(),
        "a NativeSurfaceError variant names a token `mod fail` does not declare"
    );
}
