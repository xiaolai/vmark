//! Tests for `secret_token.rs`.

use super::*;

/// 32 bytes hex-encoded. The length is public (it is fixed in source), which
/// is what lets `handshake::token_matches` settle length before hashing.
#[test]
fn secret_is_64_hex_characters() {
    let token = generate_secret_token();
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
}

/// Two mints must never collide. A repeated token would make two AI clients
/// indistinguishable — exactly the ambiguity this whole mechanism exists to
/// remove.
#[test]
fn secrets_do_not_repeat() {
    let mut seen = std::collections::HashSet::new();
    for _ in 0..1000 {
        assert!(seen.insert(generate_secret_token()), "duplicate secret");
    }
}
