//! `pinnedBy.blobRoots` counts each blob rooted only by something other
//! than a retained revision once, in the per-document and global scopes.

use crate::agent_journal::gc_plan::{GcLimit, GcPolicy, GcWarningKind};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::test_support::*;

#[test]
fn blob_roots_count_each_blob_only_a_non_revision_root_keeps_once() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    human_save(&w, doc, "base text");
    human_save(&w, doc, "head text");
    // Pending on the head: its observedPreimage is the head's postimage
    // (a revision keeps it); only its postimage is a blob-only root.
    observe(&w, doc, "pending text", None);
    let report = w
        .collect(&GcPolicy {
            max_doc_bytes: 1,
            max_total_bytes: 1,
            ..GcPolicy::default()
        })
        .expect("collect");
    for limit in [GcLimit::DocBytes, GcLimit::TotalBytes] {
        let warn = report
            .warnings
            .iter()
            .find(|x| x.kind == GcWarningKind::PinnedOverCap && x.limit == limit)
            .unwrap_or_else(|| panic!("{limit:?} over cap warns"));
        assert_eq!(
            warn.pinned_by.get("blobRoots"),
            Some(&1),
            "{limit:?}: {:?}",
            warn.pinned_by
        );
    }
}
