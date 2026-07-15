//! WI-P6.1 H1 — profile-open authorization tests.

use super::*;

fn grant(profile: &str, pattern: &str) -> ProfileOpen {
    ProfileOpen {
        profile: profile.into(),
        origin_pattern: pattern.into(),
    }
}

#[test]
fn authorizes_the_exact_profile_and_origin_then_is_spent() {
    let mut grants = vec![grant("work", "https://github.com")];
    assert!(consume_profile_open(
        &mut grants,
        "work",
        "https://github.com/account"
    ));
    assert!(grants.is_empty(), "single-use");
}

#[test]
fn refuses_a_different_profile_or_origin() {
    let mut grants = vec![grant("work", "https://github.com")];
    // Different profile — the "guess github-work then open personal" case.
    assert!(!consume_profile_open(
        &mut grants,
        "personal",
        "https://github.com/x"
    ));
    // Different origin.
    assert!(!consume_profile_open(
        &mut grants,
        "work",
        "https://evil.com/x"
    ));
    // Origin matching is no looser than a standing grant (no subdomain wildcarding).
    assert!(!consume_profile_open(
        &mut grants,
        "work",
        "https://gist.github.com/x"
    ));
    assert_eq!(grants.len(), 1, "refused attempts must not spend it");
}

#[test]
fn a_bad_profile_name_is_never_consumable() {
    for bad in ["../etc", "has space", "sql'x", "", &"a".repeat(65)] {
        let mut grants = vec![grant(bad, "https://x.com")];
        assert!(
            !consume_profile_open(&mut grants, bad, "https://x.com/y"),
            "{bad:?} must be refused"
        );
    }
}

#[test]
fn a_non_navigable_origin_is_refused() {
    let mut grants = vec![grant("work", "https://github.com")];
    assert!(!consume_profile_open(&mut grants, "work", "about:blank"));
}

#[test]
fn validate_profile_accepts_the_safe_charset_only() {
    for ok in ["work", "work_login", "a.b-c", "AZ09"] {
        assert!(validate_profile(ok).is_ok(), "{ok:?}");
    }
    for bad in ["", "has space", "../x", "emoji🔑", &"a".repeat(65)] {
        assert!(validate_profile(bad).is_err(), "{bad:?}");
    }
}
