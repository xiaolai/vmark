//! Snapshot CAS (ADR-C4 storage tier). Spec §4: content-addressed store
//! under `.vmark/snapshots/sha256/<aa>/<rest>`; text snapshots hold the
//! identity-masked canonical bytes (self-verifying: SHA-256(stored) ==
//! key); binaries hold raw bytes; writes are tmp+fsync+rename; snapshots
//! are never rewritten or deleted (v0 — GC is O3); reads verify and
//! surface Missing/Corrupt explicitly, never silently empty (spec §4.3).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::canonical::{
    binary_content_hash, canonical_masked_bytes, insert_identity, text_content_hash,
};
use super::types::ContentHash;

#[derive(Debug)]
pub enum CasError {
    Missing,
    Corrupt,
    Io(String),
}

impl std::fmt::Display for CasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CasError::Missing => write!(f, "snapshot missing"),
            CasError::Corrupt => write!(f, "snapshot corrupt (hash mismatch)"),
            CasError::Io(e) => write!(f, "snapshot io error: {e}"),
        }
    }
}

pub struct SnapshotStore {
    root: PathBuf,
}

impl SnapshotStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn path_for(&self, hash: &ContentHash) -> PathBuf {
        let hex = hash.hex();
        self.root.join("sha256").join(&hex[..2]).join(&hex[2..])
    }

    /// Store a text document: identity-masked canonical bytes (spec §4.2).
    pub fn put_text(&self, content: &str) -> Result<ContentHash, String> {
        let bytes = canonical_masked_bytes(content);
        let hash = text_content_hash(content);
        self.put_raw(&hash, bytes.as_bytes())?;
        Ok(hash)
    }

    /// Store binary content: raw bytes (spec §3.4).
    pub fn put_binary(&self, bytes: &[u8]) -> Result<ContentHash, String> {
        let hash = binary_content_hash(bytes);
        self.put_raw(&hash, bytes)?;
        Ok(hash)
    }

    /// FATALLY fsync the blob's directory AND every ancestor up to the store
    /// root, so a prior `put_*` rename — and the creation of any new
    /// `sha256/<aa>` or `sha256/` directory entry along the way — is durable
    /// before a caller records a reference to it (re-review #2/#6): a
    /// group-commit stages content, then appends a durable prepare that points at
    /// it. A crash between them could otherwise lose an un-synced directory entry
    /// (the leaf rename OR a freshly-created ancestor) and orphan the staged
    /// content, breaking client-less recovery. `put_raw`'s dir fsync is
    /// best-effort (the content is content-addressed, so a lost general-capture
    /// entry is re-capturable); this is the fatal form group staging needs before
    /// the prepare append — every failure aborts the staging.
    pub fn sync_dir_of(&self, hash: &ContentHash) -> Result<(), String> {
        let blob = self.path_for(hash);
        let mut dir = blob.parent(); // sha256/<aa>, then sha256, then the root
        while let Some(d) = dir {
            Self::fsync_dir(d)?;
            if d == self.root {
                break;
            }
            dir = d.parent();
        }
        Ok(())
    }

    fn fsync_dir(dir: &Path) -> Result<(), String> {
        let f = fs::File::open(dir)
            .map_err(|e| format!("cas dir open failed ({}): {e}", dir.display()))?;
        f.sync_all()
            .map_err(|e| format!("cas dir fsync failed ({}): {e}", dir.display()))
    }

    fn put_raw(&self, hash: &ContentHash, bytes: &[u8]) -> Result<(), String> {
        let target = self.path_for(hash);
        if target.exists() {
            // Verify before trusting (audit R20): a corrupt pre-existing
            // snapshot must not let capture succeed with a dangling
            // reference — repair it in place via the same tmp+rename.
            use sha2::{Digest, Sha256};
            if let Ok(existing) = fs::read(&target) {
                let digest: [u8; 32] = Sha256::digest(&existing).into();
                if &ContentHash::from_digest(&digest) == hash {
                    return Ok(()); // identical hash = identical content
                }
            }
            // fall through: rewrite the corrupt/unreadable snapshot
        }
        // mkdir -p before EVERY write — git prunes empty dirs (S1 finding).
        let tmp_dir = self.root.join("tmp");
        fs::create_dir_all(&tmp_dir).map_err(|e| format!("snapshot tmp mkdir failed: {e}"))?;
        fs::create_dir_all(target.parent().expect("cas path has parent"))
            .map_err(|e| format!("snapshot mkdir failed: {e}"))?;
        let tmp_path = tmp_dir.join(Uuid::now_v7().to_string());
        let mut f =
            fs::File::create(&tmp_path).map_err(|e| format!("snapshot create failed: {e}"))?;
        f.write_all(bytes)
            .map_err(|e| format!("snapshot write failed: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("snapshot fsync failed: {e}"))?;
        drop(f);
        fs::rename(&tmp_path, &target).map_err(|e| format!("snapshot rename failed: {e}"))?;
        if let Some(parent) = target.parent() {
            if let Ok(d) = fs::File::open(parent) {
                let _ = d.sync_all(); // best-effort dir fsync (spec §4.3)
            }
        }
        Ok(())
    }

    pub fn contains(&self, hash: &ContentHash) -> bool {
        self.path_for(hash).exists()
    }

    /// Read and verify a snapshot (spec §4.3: explicit errors, never
    /// silently empty).
    pub fn get(&self, hash: &ContentHash) -> Result<Vec<u8>, CasError> {
        let path = self.path_for(hash);
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(CasError::Missing),
            Err(e) => return Err(CasError::Io(e.to_string())),
        };
        use sha2::{Digest, Sha256};
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        if &ContentHash::from_digest(&digest) != hash {
            return Err(CasError::Corrupt);
        }
        Ok(bytes)
    }

    /// Materialize a text revision to its on-disk form: stored bytes plus
    /// the target object's identity block from the ledger registry
    /// (spec §4.2 — the ledger, not the snapshot, owns identity).
    pub fn materialize_text(
        &self,
        hash: &ContentHash,
        object_id: &str,
        schema: Option<&str>,
    ) -> Result<String, CasError> {
        let bytes = self.get(hash)?;
        let text = String::from_utf8(bytes).map_err(|_| CasError::Corrupt)?;
        Ok(insert_identity(&text, object_id, schema))
    }
}

#[cfg(test)]
#[path = "cas.test.rs"]
mod tests;
