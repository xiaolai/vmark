//! Comparing a presented secret against an expected one (CWE-208).
//!
//! Split out of `handshake.rs` so the two things that compare secrets can
//! share one implementation without one depending on the other's policy:
//! `handshake.rs` checks the shared bridge token from the port file, and
//! `principal.rs` checks the per-client credential against every provider's
//! configured one.

use sha2::{Digest, Sha256};

/// Compare a presented token against the expected one without a
/// data-dependent early exit.
///
/// `==` on `str` short-circuits at the first differing byte, leaking a prefix
/// oracle. That oracle is reachable *only* by the different-UID or browser
/// attacker the token exists to stop — a same-UID process just reads the port
/// file — so loopback TCP is precisely the design where it matters.
///
/// What this does: both sides are hashed to a fixed 32 bytes, so the fold's
/// trip count does not depend on the inputs; the fold ORs every byte
/// difference together, so no branch depends on the data; `black_box` then
/// asks the optimiser not to reintroduce an early exit. Hashing with the
/// already-vendored `sha2` avoids adding a crate.
///
/// What this is NOT (audit round 2, item 2): `black_box` is documented by the
/// language as a *hint* that guarantees nothing, explicitly not a
/// cryptographic primitive, and it is applied once after the reduction rather
/// than throughout. `subtle::ConstantTimeEq` keeps `Choice` optimisation
/// barriers across the whole comparison and is the strictly stronger option.
/// The judgement here — best effort, no new dependency — is proportionate for
/// a loopback-only secret; if this token ever guards something a REMOTE
/// attacker can reach, adopt `subtle` rather than trusting this.
///
/// An empty token never matches: a missing `token` field must not
/// authenticate. The length is settled first, and that is safe: the expected
/// token is always two hex UUIDs (`crate::secret_token`), a length fixed in
/// source and therefore public. Short-circuiting on it leaks nothing about
/// the secret, and it bounds the hashing work by the secret's size instead of
/// by whatever the peer chose to send (audit round 1, out-of-scope item 2).
/// What is NOT safe to short-circuit on is the token's *content* — that is
/// the prefix oracle the fold below removes.
pub(super) fn token_matches(presented: &str, expected: &str) -> bool {
    if presented.is_empty() || expected.is_empty() || presented.len() != expected.len() {
        return false;
    }
    let presented = Sha256::digest(presented.as_bytes());
    let expected = Sha256::digest(expected.as_bytes());
    let mut diff = 0u8;
    for (a, b) in presented.iter().zip(expected.iter()) {
        diff |= a ^ b;
    }
    std::hint::black_box(diff) == 0
}

#[cfg(test)]
#[path = "token_compare.test.rs"]
mod tests;
