//! The provisional grouping that bounds reconciliation: a lookup of an
//! existing file sees only the provisional mappings that could be another
//! spelling of it, however many others the index holds, and the groups
//! follow every put, move, rewrite and reopen.

use std::collections::BTreeSet;

use crate::agent_journal::doc_index::{DocIndex, IndexEntry};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::test_support::tmp;

fn entry(path: &str, provisional: bool) -> IndexEntry {
    IndexEntry {
        doc: DocId::new(),
        path: path.to_owned(),
        file_id: None,
        provisional,
    }
}

fn near(index: &DocIndex, path: &str) -> BTreeSet<String> {
    index.provisional_near(path).cloned().collect()
}

#[test]
fn only_the_requested_files_group_is_offered_however_many_others_exist() {
    let journal = tmp();
    let (mut index, _) = DocIndex::open(journal.path()).unwrap();
    index
        .remap(|entries| {
            for i in 0..2000 {
                let path = format!("/docs/other{i}/new.md");
                entries.insert(format!("path:{path}"), entry(&path, true));
            }
        })
        .unwrap();
    index
        .put("path:/docs/Sub/new.md", entry("/docs/Sub/new.md", true))
        .unwrap();
    index
        .put("path:/docs/sub/new.md", entry("/docs/sub/new.md", false))
        .unwrap();
    let alias = BTreeSet::from(["path:/docs/Sub/new.md".to_owned()]);
    assert_eq!(
        near(&index, "/docs/sub/new.md"),
        alias,
        "2001 provisional, one offered"
    );
    assert!(near(&index, "/docs/unrelated.md").is_empty());

    drop(index);
    let (mut index, _) = DocIndex::open(journal.path()).unwrap();
    assert_eq!(near(&index, "/docs/sub/new.md"), alias, "after reopen");

    index
        .move_key(
            "path:/docs/Sub/new.md",
            "path:/docs/sub/new.md",
            entry("/docs/sub/new.md", false),
        )
        .unwrap();
    assert!(near(&index, "/docs/sub/new.md").is_empty(), "reconciled");
    index
        .put("path:/docs/SUB/new.md", entry("/docs/SUB/new.md", true))
        .unwrap();
    index.remove("path:/docs/other0/new.md").unwrap();
    assert_eq!(
        near(&index, "/docs/sub/new.md"),
        BTreeSet::from(["path:/docs/SUB/new.md".to_owned()]),
        "after a put and a rewrite"
    );
    index
        .put("path:/docs/SUB/new.md", entry("/docs/SUB/new.md", false))
        .unwrap();
    assert!(
        near(&index, "/docs/sub/new.md").is_empty(),
        "no longer provisional"
    );
}
