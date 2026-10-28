//! Identifiers used by journal schema v1.
//!
//! Every id is a newtype so a revision id can never be passed where a
//! transaction id is expected. UUIDs are v7 (time-ordered) when minted here;
//! the decoder accepts any UUID version because legacy and foreign ids exist.
//! `BlobHash` is a content address (`sha256-<64 hex>`) over the UTF-8 bytes of
//! canonical editor text.

use serde::{Deserialize, Serialize};
use sha2_v011::{Digest, Sha256};
use uuid::Uuid;

macro_rules! uuid_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            /// Mint a new time-ordered id.
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

uuid_id!(
    /// Immutable journal document identity, minted at tab creation.
    DocId
);
uuid_id!(
    /// A linearized revision of one document.
    RevisionId
);
uuid_id!(
    /// Every record carries one. A controlled mutation's `prepared`, its
    /// terminal record and an observation's `pendingObservation` + its
    /// linearization record share the transaction id.
    TxnId
);
uuid_id!(
    /// An MCP connection, minted per authenticated connection.
    ConnectionId
);

/// Content address of a blob: `sha256-` followed by 64 lowercase hex digits.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct BlobHash(String);

#[cfg(test)]
thread_local! {
    static HASHED: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

impl BlobHash {
    /// Hash canonical text (its UTF-8 bytes).
    pub fn of_text(text: &str) -> Self {
        Self::of_bytes(text.as_bytes())
    }

    /// Hash raw bytes.
    pub fn of_bytes(bytes: &[u8]) -> Self {
        #[cfg(test)]
        HASHED.with(|h| h.set(h.get() + bytes.len() as u64));
        Self(format!("sha256-{}", sha256_hex(bytes)))
    }

    /// The bytes hashed on this thread since the last take.
    #[cfg(test)]
    pub(crate) fn take_hashed() -> u64 {
        HASHED.with(|h| h.replace(0))
    }

    /// The textual form stored in records.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The bare 64-hex digest — the form a hunk id hashes (`textHash`).
    pub fn digest_hex(&self) -> &str {
        &self.0["sha256-".len()..]
    }
}

impl TryFrom<String> for BlobHash {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        let digest = s
            .strip_prefix("sha256-")
            .ok_or("blob hash must start with sha256-")?;
        if is_sha256_hex(digest) {
            Ok(Self(s))
        } else {
            Err(format!("malformed blob hash: {s}"))
        }
    }
}

impl From<BlobHash> for String {
    fn from(h: BlobHash) -> String {
        h.0
    }
}

/// Hunk id = hash of (base revision, target revision, base range, target
/// range, base text hash, target text hash). Computed by
/// `Hunk::compute_id`; the writer refuses a hunk whose id does not match.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HunkId(pub String);

/// Lowercase hex of a byte slice.
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// Lowercase hex SHA-256 of `bytes`, no prefix: a blob hash's digest and a
/// hunk id's `textHash` alike.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// `s` is a bare SHA-256 digest: exactly 64 lowercase hex digits.
pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
