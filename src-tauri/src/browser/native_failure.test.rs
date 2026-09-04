//! Audit 20260903 round 3 #31 / round 4 — the native failure vocabulary is a
//! closed enum carried typed across the hop, every producer's token has exactly
//! one variant, and the one remaining string seam parses back to the same class.

use super::*;

/// Every tagged class, built with `detail`.
fn tagged(detail: &str) -> Vec<NativeSurfaceError> {
    NativeSurfaceError::TAGGED
        .iter()
        .map(|make| make(detail.to_string()))
        .collect()
}

#[test]
fn every_tagged_class_round_trips_through_its_own_rendering() {
    for error in tagged("some detail: with a colon, and https://x.test/?e=NO_WEBVIEW") {
        let rendered = error.to_string();
        assert_eq!(NativeSurfaceError::parse(&rendered), error, "{rendered}");
        // The rendering is `TOKEN: detail` — the seam's delimiter, not a guess.
        let token = error.token().expect("tagged");
        assert_eq!(rendered, format!("{token}: {}", error.detail()));
        // `From<String>` is the same parse: what `?` does at a String-errored seam.
        assert_eq!(NativeSurfaceError::from(rendered), error);
    }
    // The bare form (`PROFILE_STORE_LIMIT` ships without a detail).
    for error in tagged("") {
        let bare = error.to_string();
        assert_eq!(Some(bare.as_str()), error.token());
        assert_eq!(NativeSurfaceError::parse(&bare), error, "{bare}");
    }
}

#[test]
fn tokens_are_unique_and_the_unclassified_class_has_none() {
    let mut tokens: Vec<&str> = tagged("")
        .iter()
        .map(|error| error.token().expect("every TAGGED class carries a token"))
        .collect();
    tokens.sort_unstable();
    tokens.dedup();
    assert_eq!(
        tokens.len(),
        NativeSurfaceError::TAGGED.len(),
        "two classes share a token"
    );
    let plain = NativeSurfaceError::Unclassified("plain prose".into());
    assert_eq!(plain.token(), None);
    // An unclassified failure renders as its own text — no token is invented for it.
    assert_eq!(plain.to_string(), "plain prose");
    assert_eq!(plain.detail(), "plain prose");
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
            NativeSurfaceError::Unclassified(message.clone()),
            "{message:?} was classified by an unanchored match"
        );
    }
}

#[test]
fn the_string_seam_and_the_typed_path_agree() {
    // `AsNativeFailure` is how `surface_failure` accepts both the typed error and
    // the rendering a not-yet-typed caller hands it; the two must be the same class.
    let typed = NativeSurfaceError::DialogNotOwned("dialog #3 belongs to another window".into());
    assert_eq!(typed.as_native_failure(), typed);
    assert_eq!(typed.to_string().as_native_failure(), typed);
    assert_eq!(typed.to_string().as_str().as_native_failure(), typed);
    // A tag with no space after the colon still parses to the same class and detail.
    assert_eq!(
        NativeSurfaceError::parse(&format!("{}:gone", fail::WINDOW_GONE)),
        NativeSurfaceError::WindowGone("gone".into())
    );
}

/// The contract is `surface::fail`, whose constants name the wire spelling of every
/// class. Read that block from source so a constant added there without a variant
/// here, or a variant whose token no constant names, fails — the
/// producer/classifier drift the string chain allowed.
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
    let tokens: Vec<&str> = tagged("")
        .iter()
        .filter_map(|error| error.token())
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
