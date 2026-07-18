//! Core kernel types (pure — ADR-C4). Wire formats per spec §2 and §5.
//!
//! Purpose: identity newtypes with validated constructors and the spec §5
//! body types (the entry envelope + typed dispatch live in `envelope.rs`,
//! re-exported here). History immutability (I2/I5) is enforced at the
//! ledger API layer; these are immutable value types.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// On-disk format number this build reads and writes (spec header).
pub const FORMAT_VERSION: u32 = 0;

fn is_lower_hex_64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Stable object identity (frontmatter `vmark.id`, spec §2.1). UUIDv7.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ObjectId(pub Uuid);

/// Per-installation writer identity (spec §2.2). UUIDv7.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WriterId(pub Uuid);

/// Canonicalized content hash: `sha256:` + 64 lowercase hex (spec §3.2).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ContentHash(String);

impl ContentHash {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.strip_prefix("sha256:") {
            Some(hex) if is_lower_hex_64(hex) => Ok(Self(s.to_string())),
            _ => Err(format!("invalid content hash: {s:?}")),
        }
    }
    /// Wrap a raw SHA-256 digest.
    pub fn from_digest(digest: &[u8; 32]) -> Self {
        let mut s = String::with_capacity(7 + 64);
        s.push_str("sha256:");
        for b in digest {
            s.push_str(&format!("{b:02x}"));
        }
        Self(s)
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// The 64-hex payload without the algorithm prefix (CAS path key).
    pub fn hex(&self) -> &str {
        &self.0["sha256:".len()..]
    }
}

impl TryFrom<String> for ContentHash {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        Self::parse(&s)
    }
}
impl From<ContentHash> for String {
    fn from(h: ContentHash) -> String {
        h.0
    }
}

/// Revision identity: content hash + sorted parent links (spec §2.3).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RevisionId(String);

impl RevisionId {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.strip_prefix("rev1:") {
            Some(hex) if is_lower_hex_64(hex) => Ok(Self(s.to_string())),
            _ => Err(format!("invalid revision id: {s:?}")),
        }
    }
    /// `rev1:` identity: SHA-256 over a domain separator, the content
    /// hash, and the lexicographically sorted parents (spec §2.3).
    pub fn compute(content: &ContentHash, parents: &[RevisionId]) -> Self {
        let mut sorted: Vec<&str> = parents.iter().map(|p| p.0.as_str()).collect();
        sorted.sort_unstable();
        let mut hasher = Sha256::new();
        hasher.update(b"vmark-rev\n");
        hasher.update(content.as_str().as_bytes());
        hasher.update(b"\n");
        for p in sorted {
            hasher.update(p.as_bytes());
            hasher.update(b"\n");
        }
        let digest: [u8; 32] = hasher.finalize().into();
        let mut s = String::with_capacity(5 + 64);
        s.push_str("rev1:");
        for b in digest {
            s.push_str(&format!("{b:02x}"));
        }
        Self(s)
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RevisionId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        Self::parse(&s)
    }
}
impl From<RevisionId> for String {
    fn from(r: RevisionId) -> String {
        r.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Human,
    Model,
    External,
    Git,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agent {
    #[serde(rename = "type")]
    pub kind: AgentType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputRole {
    Direct,
    Contextual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Exact,
    Inferred,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputRef {
    pub object: ObjectId,
    pub revision: RevisionId,
    pub role: InputRole,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputRef {
    pub object: ObjectId,
    pub revision: RevisionId,
    pub content_hash: ContentHash,
    pub parents: Vec<RevisionId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intent {
    pub kind: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_hash: Option<ContentHash>,
}

/// Spec §5.4.1 — the provenance record. Immutable once appended (I2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transformation {
    pub inputs: Vec<InputRef>,
    pub outputs: Vec<OutputRef>,
    pub agent: Agent,
    pub intent: Intent,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitOp {
    pub op: String,
    pub from: String,
    pub to: String,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub ref_name: Option<String>,
}

/// Spec §5.4.2 — git state-jump record. Never mints revisions (R18).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Navigation {
    pub git: GitOp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActorType {
    Human,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    #[serde(rename = "type")]
    pub kind: ActorType,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeRef {
    /// Entry id of the transformation that recorded the origin edge.
    pub txf: Uuid,
    /// Index into that transformation's `inputs`.
    pub input: u32,
}

/// Spec §5.4.3 — ratification and waiver share one shape (append-only, I5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resolution {
    pub edge: EdgeRef,
    pub upstream_object: ObjectId,
    pub pinned: RevisionId,
    pub resolved_against: RevisionId,
    pub actor: Actor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
}

/// Spec §5.4.6 — ledger-side identity registry entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectRegistered {
    pub object: ObjectId,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<Vec<ObjectId>>,
}

/// Spec §5.4.7 — durable workspace finding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

// The entry envelope and typed-body dispatch live in `envelope.rs`;
// re-exported here so consumers keep one import path.
pub use super::envelope::{Envelope, TypedBody};

#[cfg(test)]
#[path = "types.test.rs"]
mod tests;
