// WI-1.3 — snapshot CAS (spec §4): identity-masked canonical bytes keyed
// by their own hash (self-verifying), tmp+fsync+rename writes, never
// rewritten, missing/corrupt snapshots surface explicit errors, and
// materialization re-inserts the identity block from registry data.

use super::*;
use crate::coherence::canonical::{mask_identity, text_content_hash};

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

const DOC: &str = "---\ntitle: Elena\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n  schema: character\n---\n# Elena\nEyes: green.\n";

#[test]
fn put_text_stores_masked_canonical_bytes_under_their_hash() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let hash = store.put_text(DOC).unwrap();
    assert_eq!(hash, text_content_hash(DOC));
    let stored = store.get(&hash).unwrap();
    assert_eq!(
        String::from_utf8(stored).unwrap(),
        mask_identity(DOC),
        "identity block masked out of stored bytes"
    );
}

#[test]
fn snapshots_are_self_verifying() {
    use sha2::{Digest, Sha256};
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let hash = store.put_text(DOC).unwrap();
    let stored = store.get(&hash).unwrap();
    let digest: [u8; 32] = Sha256::digest(&stored).into();
    assert_eq!(
        crate::coherence::types::ContentHash::from_digest(&digest),
        hash
    );
}

#[test]
fn identical_content_with_different_identity_dedupes() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let other_id = DOC.replace(
        "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7",
        "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8",
    );
    let h1 = store.put_text(DOC).unwrap();
    let h2 = store.put_text(&other_id).unwrap();
    assert_eq!(h1, h2, "identity keys never split the CAS");
}

#[test]
fn put_is_idempotent_and_never_rewrites() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let h1 = store.put_text(DOC).unwrap();
    let h2 = store.put_text(DOC).unwrap();
    assert_eq!(h1, h2);
    assert_eq!(store.get(&h1).unwrap(), mask_identity(DOC).into_bytes());
}

#[test]
fn get_missing_snapshot_is_an_explicit_error() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let absent =
        crate::coherence::types::ContentHash::parse(&format!("sha256:{}", "0".repeat(64))).unwrap();
    assert!(matches!(store.get(&absent), Err(CasError::Missing)));
}

#[test]
fn corrupt_snapshot_is_detected_not_returned() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let hash = store.put_text(DOC).unwrap();
    let path = store.path_for(&hash);
    std::fs::write(&path, b"tampered").unwrap();
    assert!(matches!(store.get(&hash), Err(CasError::Corrupt)));
}

#[test]
fn binary_roundtrip_is_raw_bytes() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let bytes: Vec<u8> = vec![0xff, 0x00, 0x1f, 0x8b, 0x0d, 0x0a];
    let hash = store.put_binary(&bytes).unwrap();
    assert_eq!(store.get(&hash).unwrap(), bytes);
}

#[test]
fn put_recreates_pruned_directories() {
    let dir = tmp();
    let root = dir.path().join("snapshots");
    let store = SnapshotStore::new(root.clone());
    store.put_text(DOC).unwrap();
    std::fs::remove_dir_all(&root).unwrap();
    let hash = store.put_text(DOC).unwrap();
    assert!(store.get(&hash).is_ok());
}

#[test]
fn materialize_reinserts_identity_from_registry_data() {
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let hash = store.put_text(DOC).unwrap();
    let out = store
        .materialize_text(
            &hash,
            "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7",
            Some("character"),
        )
        .unwrap();
    assert_eq!(
        out, DOC,
        "materialization restores the exact canonical document"
    );
    // A different object id materializes the same content under ITS identity.
    let other = store
        .materialize_text(&hash, "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8", None)
        .unwrap();
    assert!(other.contains("018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8"));
    assert!(!other.contains("schema:"));
}

#[test]
fn sync_dir_of_is_fatal_and_walks_ancestors() {
    // Re-review #2: group staging must FATALLY sync the blob's directory and its
    // freshly-created ancestors before the prepare references it. Success on a
    // real staged blob (the ancestor walk fsyncs sha256/<aa>, sha256, root); a
    // hard error when the directory is absent (proving it is NOT best-effort).
    let dir = tmp();
    let store = SnapshotStore::new(dir.path().join("snapshots"));
    let hash = store.put_text(DOC).unwrap();
    store
        .sync_dir_of(&hash)
        .expect("staged blob's dir + ancestors sync durably");

    // If the blob's directory does not exist, the fatal sync must surface an
    // error — a silent success here is exactly the durability gap #2 flagged.
    let missing = text_content_hash("never stored\n");
    let err = store.sync_dir_of(&missing).unwrap_err();
    assert!(err.contains("cas dir"), "got: {err}");
}
