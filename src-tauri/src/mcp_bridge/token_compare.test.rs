//! Tests for `token_compare.rs` (moved with the function out of
//! `handshake.test.rs`; unchanged assertions).

use super::*;

#[test]
fn token_matches_only_the_exact_token() {
    let expected = "9f8c1d2e3a4b5c6d7e8f90a1b2c3d4e5";
    assert!(token_matches(expected, expected));
    assert!(!token_matches("9f8c1d2e3a4b5c6d7e8f90a1b2c3d4e6", expected));
    // A correct prefix must not pass — that is the oracle the fold removes.
    assert!(!token_matches("9f8c1d2e", expected));
    assert!(!token_matches(&format!("{expected}x"), expected));
    // Case-sensitive, not normalized.
    assert!(!token_matches(&expected.to_uppercase(), expected));
}

/// A client that omits `token` presents `""`. It must never authenticate,
/// even in the impossible case of an empty expectation.
#[test]
fn empty_token_never_matches() {
    assert!(!token_matches("", "9f8c1d2e"));
    assert!(!token_matches("9f8c1d2e", ""));
    assert!(!token_matches("", ""));
}

/// A wrong-length presentation never matches, at any length.
///
/// Honest scope: the length short-circuit added in audit round 1 bounds the
/// hashing work by the secret's size instead of by whatever the peer sent —
/// it cannot change a verdict, because differing lengths already produced
/// differing digests. So this pins the behaviour (including the megabyte
/// case, which must not be an exception) rather than proving the
/// optimisation; the safety argument for short-circuiting is that the
/// expected token's length is a compile-time constant, not a secret.
#[test]
fn a_wrong_length_token_never_matches() {
    let expected = super::super::state::generate_auth_token();
    assert!(!token_matches(&"x".repeat(1_000_000), &expected));
    assert!(!token_matches(&expected[..expected.len() - 1], &expected));
    assert!(!token_matches(&format!("{expected}0"), &expected));
}

/// Real tokens from the generator round-trip.
#[test]
fn generated_tokens_match_themselves_and_not_each_other() {
    let a = super::super::state::generate_auth_token();
    let b = super::super::state::generate_auth_token();
    assert!(token_matches(&a, &a));
    assert!(!token_matches(&a, &b));
}
