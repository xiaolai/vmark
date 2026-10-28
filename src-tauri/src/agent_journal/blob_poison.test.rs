// WI-AL2.0h — a poisoned blob pack no longer trusts its index: put refuses without consulting it and contains is false, while get still reads through the old handle
//! R58 rule 2, test 6. After an ambiguous failure the index may list a blob
//! the file no longer holds (a compaction that failed past its rename), so
//! presence is no proof of durability; the bytes the old handle names are
//! still valid to read until reopen.

use std::sync::Arc;

use super::BlobStore;
use crate::agent_journal::faults::Faults;
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::journal_file::SyncPolicy;

#[test]
fn a_poisoned_pack_refuses_put_without_consulting_its_index() {
    let dir = tempfile::tempdir().unwrap();
    let mut pack =
        BlobStore::open(dir.path(), SyncPolicy::None, Arc::new(Faults::default())).unwrap();
    let stored = BlobHash::of_text("stored");
    pack.put(&stored, "stored").unwrap();
    assert!(pack.contains(&stored));
    let len = std::fs::metadata(dir.path().join(super::BLOB_PACK))
        .unwrap()
        .len();

    pack.poison();

    assert!(!pack.contains(&stored), "a poisoned index is untrusted");
    let err = pack.put(&stored, "stored").unwrap_err();
    assert_eq!(err.code(), "JOURNAL_IO", "an indexed hash is refused too");
    let fresh = BlobHash::of_text("fresh");
    assert_eq!(pack.put(&fresh, "fresh").unwrap_err().code(), "JOURNAL_IO");
    assert_eq!(
        std::fs::metadata(dir.path().join(super::BLOB_PACK))
            .unwrap()
            .len(),
        len,
        "nothing was written"
    );
    assert_eq!(pack.get(&stored).unwrap(), "stored", "reads still work");
}
