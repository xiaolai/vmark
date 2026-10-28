//! WI-AL1.6 — the rename paths a batch hands the agent journal so an
//! external rename keeps a document's identity.

use super::*;
use crate::watcher::batch::{FsChange, FsChangeBatch, FsChangeKind};
use std::path::PathBuf;

fn batch(changes: Vec<FsChange>) -> FsChangeBatch {
    FsChangeBatch {
        watch_id: "main".into(),
        root_path: "/w".into(),
        changes,
        rescan: false,
    }
}

#[test]
fn only_rename_paths_reach_the_journal_in_order_and_once_each() {
    let b = batch(vec![
        FsChange {
            kind: FsChangeKind::Modify,
            paths: vec!["/w/m.md".into()],
        },
        FsChange {
            kind: FsChangeKind::Rename,
            paths: vec!["/w/a.md".into(), "/w/b.md".into()],
        },
        FsChange {
            kind: FsChangeKind::Rename,
            paths: vec!["/w/b.md".into()],
        },
        FsChange {
            kind: FsChangeKind::Rename,
            paths: vec!["/w/文档 c.md".into()],
        },
    ]);
    let want: Vec<PathBuf> = ["/w/a.md", "/w/b.md", "/w/文档 c.md"]
        .iter()
        .map(PathBuf::from)
        .collect();
    assert_eq!(rename_paths(&b), want);
}

#[test]
fn a_batch_without_renames_hands_over_nothing() {
    assert!(rename_paths(&batch(vec![])).is_empty());
    let b = batch(vec![FsChange {
        kind: FsChangeKind::Create,
        paths: vec!["/w/x.md".into()],
    }]);
    assert!(rename_paths(&b).is_empty());
}

// `tauri::test::MockRuntime` does not exist on Windows; gated like every
// mock-runtime suite.
#[cfg(not(target_os = "windows"))]
mod on_a_mock_app {
    use super::super::deliver;
    use crate::agent_journal::ids::DocId;
    use crate::agent_journal::service::{start, AgentJournalState};
    use crate::watcher::batch::{FsChange, FsChangeBatch, FsChangeKind};
    use std::sync::{Arc, Mutex};
    use tauri::{Emitter, Listener, Manager};

    fn resolve(state: &AgentJournalState, key: &str) -> DocId {
        state
            .controller()
            .expect("journal ready")
            .docs
            .resolve(key)
            .expect("resolve")
    }

    #[test]
    fn a_child_of_a_renamed_directory_resolved_at_delivery_keeps_its_document() {
        let (app_data, docs) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let state = AgentJournalState::default();
        state.finish(start(app_data.path()));
        app.manage(state);
        let window = tauri::webview::WebviewWindowBuilder::new(
            &app,
            "al16-dir",
            tauri::WebviewUrl::default(),
        )
        .visible(false)
        .build()
        .expect("build mock window");

        let old = docs.path().join("笔记 notes");
        std::fs::create_dir_all(old.join("deep")).unwrap();
        std::fs::write(old.join("deep").join("a.md"), "x").unwrap();
        let key =
            |dir: &std::path::Path| format!("path:{}", dir.join("deep").join("a.md").display());
        let journal = app.state::<AgentJournalState>();
        let original = resolve(&journal, &key(&old));
        let new = docs.path().join("archive");
        std::fs::rename(&old, &new).unwrap();

        // The window opens the moved child the moment `fs:changed` arrives.
        let seen = Arc::new(Mutex::new(None));
        let (sink, handle, new_key) = (Arc::clone(&seen), app.handle().clone(), key(&new));
        window.listen("fs:changed", move |_| {
            let journal = handle.state::<AgentJournalState>();
            *sink.lock().unwrap() = Some(resolve(&journal, &new_key));
        });
        let batch = FsChangeBatch {
            watch_id: "al16-dir".into(),
            root_path: docs.path().to_string_lossy().into_owned(),
            changes: vec![FsChange {
                kind: FsChangeKind::Rename,
                paths: vec![
                    old.to_string_lossy().into_owned(),
                    new.to_string_lossy().into_owned(),
                ],
            }],
            rescan: false,
        };
        deliver(app.handle(), &batch, || {
            app.emit_to("al16-dir", "fs:changed", &batch).unwrap();
        });

        assert_eq!(
            *seen.lock().unwrap(),
            Some(original),
            "a child resolved at delivery has its original document"
        );
    }
}
