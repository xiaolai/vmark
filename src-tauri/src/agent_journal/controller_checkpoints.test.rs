// WI-AL1.6 — the frontend's checkpoint store in the journal: an appended checkpoint lists back (file anchor and untitled-tab anchor, CJK text), a repeat append of one id is a no-op, a malformed checkpoint is refused, a forget deletes exactly the named ids (unknown ids ignored, none named is a no-op), and a forget payload with unknown fields is refused
use std::sync::Arc;
use std::time::Duration;

use super::controller::Controller;
use super::degraded_drain::{Backoff, DrainScheduler};
use super::test_support::*;

fn controller() -> (tempfile::TempDir, Controller) {
    let (dir, c, _) = controller_with_faults();
    (dir, c)
}

fn controller_with_faults() -> (tempfile::TempDir, Controller, Arc<super::faults::Faults>) {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(Arc::new(w), Arc::default(), Arc::new(drains));
    (dir, c, faults)
}

fn checkpoint(id: &str, file: Option<&str>, before: &str) -> String {
    serde_json::json!({
        "id": id, "tabId": "tab-7", "filePath": file, "timestamp": 1_700_000_000_123u64,
        "tool": "document.write", "description": "改写第二段", "contentBefore": before,
        "revisionBefore": "r1", "revisionAfter": "r2", "byteSize": before.len(),
    })
    .to_string()
}

fn code(e: &crate::command_error::CommandError) -> String {
    e.detail().expect("detail")["journalCode"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

fn ids(c: &Controller) -> Vec<String> {
    c.checkpoints()
        .expect("list")
        .into_iter()
        .map(|v| v.id)
        .collect()
}

#[test]
fn an_appended_checkpoint_lists_back() {
    let (_d, c) = controller();
    assert!(c
        .checkpoint_append(&checkpoint("cp-1", Some("/笔记/a.md"), "原文\n"))
        .unwrap());
    assert!(c
        .checkpoint_append(&checkpoint("cp-2", None, "untitled"))
        .unwrap());
    let list = c.checkpoints().unwrap();
    assert_eq!(list.len(), 2);
    let a = &list[0];
    assert_eq!(a.id, "cp-1");
    assert_eq!(a.file_path.as_deref(), Some("/笔记/a.md"));
    assert_eq!(a.tab_id, None, "a file checkpoint is anchored on its path");
    assert_eq!(a.content_before, "原文\n");
    assert_eq!(a.timestamp, 1_700_000_000_123);
    assert_eq!(
        (a.tool.as_str(), a.description.as_str()),
        ("document.write", "改写第二段")
    );
    let b = &list[1];
    assert_eq!(
        (b.file_path.as_deref(), b.tab_id.as_deref()),
        (None, Some("tab-7"))
    );
    let json = serde_json::to_value(&list[0]).unwrap();
    assert_eq!(
        json["contentBefore"], "原文\n",
        "camelCase on the wire: {json}"
    );
}

#[test]
fn a_repeat_append_is_a_no_op() {
    let (_d, c) = controller();
    assert!(c
        .checkpoint_append(&checkpoint("cp-1", Some("/a.md"), "x"))
        .unwrap());
    assert!(!c
        .checkpoint_append(&checkpoint("cp-1", Some("/a.md"), "x"))
        .unwrap());
    assert_eq!(ids(&c), ["cp-1"]);
}

#[test]
fn a_malformed_checkpoint_is_refused() {
    let (_d, c) = controller();
    for bad in ["", "{}", "[]", r#"{"id":"x"}"#] {
        let err = c.checkpoint_append(bad).unwrap_err();
        assert_eq!(code(&err), "INVALID_REQUEST", "{bad}");
    }
    assert!(ids(&c).is_empty());
}

#[test]
fn a_forget_deletes_exactly_the_named_ids() {
    let (_d, c) = controller();
    for id in ["a", "b", "c"] {
        c.checkpoint_append(&checkpoint(id, Some("/a.md"), id))
            .unwrap();
    }
    let r = c.checkpoints_forget(r#"{"ids":["b","nope"]}"#).unwrap();
    assert_eq!(r.forgotten, 1);
    assert_eq!(ids(&c), ["a", "c"]);
    assert_eq!(c.checkpoints_forget(r#"{"ids":[]}"#).unwrap().forgotten, 0);
    assert_eq!(ids(&c), ["a", "c"]);
}

#[test]
fn a_forget_payload_with_unknown_fields_is_refused() {
    let (_d, c) = controller();
    for bad in [r#"{"ids":["a"],"all":true}"#, r#"{"ids":"a"}"#, "{}"] {
        assert_eq!(
            code(&c.checkpoints_forget(bad).unwrap_err()),
            "INVALID_REQUEST",
            "{bad}"
        );
    }
}

/// A forget landing anywhere inside a listing leaves a listing of one
/// state: never a checkpoint whose text is already deleted.
#[test]
fn a_listing_raced_by_a_forget_reads_one_state() {
    for k in 1..=4 {
        let (_d, c, faults) = controller_with_faults();
        c.checkpoint_append(&checkpoint("cp-1", None, "一"))
            .unwrap();
        c.checkpoint_append(&checkpoint("cp-2", None, "二"))
            .unwrap();
        let (listed, forgot, _) = interleave(
            &faults,
            k,
            || c.checkpoints(),
            || c.checkpoints_forget(r#"{"ids":["cp-1","cp-2"]}"#),
        );
        assert_eq!(forgot.expect("forget").forgotten, 2);
        let listed = listed.unwrap_or_else(|e| panic!("lock {k}: listing failed: {e:?}"));
        assert!(
            listed.is_empty() || listed.len() == 2,
            "lock {k}: {listed:?}"
        );
    }
}

/// The frontend's `isCheckpoint` (`checkpointClient.ts`): a non-empty id,
/// tool and chosen anchor, and a timestamp a JavaScript `Date` can hold.
/// One listed entry outside it makes the panel reject the whole list.
fn wire_valid(v: &super::controller_checkpoints::CheckpointView) -> bool {
    let anchor = match (&v.tab_id, &v.file_path) {
        (Some(t), None) | (None, Some(t)) => !t.is_empty(),
        _ => false,
    };
    !v.id.is_empty() && !v.tool.is_empty() && anchor && v.timestamp <= 8_640_000_000_000_000
}

#[test]
fn a_checkpoint_the_panel_would_reject_is_refused_and_the_list_stays_readable() {
    let (_d, c) = controller();
    let with = |patch: serde_json::Value| {
        let mut v: serde_json::Value =
            serde_json::from_str(&checkpoint("cp-x", None, "t")).unwrap();
        for (k, val) in patch.as_object().unwrap() {
            v[k] = val.clone();
        }
        v.to_string()
    };
    let bad = [
        with(serde_json::json!({"id": ""})),
        with(serde_json::json!({"tool": ""})),
        with(serde_json::json!({"tabId": "", "filePath": null})),
        with(serde_json::json!({"filePath": ""})),
        with(serde_json::json!({"timestamp": 8_640_000_000_000_001u64})),
        with(serde_json::json!({"timestamp": u64::MAX})),
    ];
    for line in &bad {
        let err = c.checkpoint_append(line).unwrap_err();
        assert_eq!(code(&err), "INVALID_REQUEST", "{line}");
    }
    let edge = with(serde_json::json!({"id": "edge", "timestamp": 8_640_000_000_000_000u64}));
    assert!(c.checkpoint_append(&edge).unwrap(), "the last Date instant");
    assert!(c
        .checkpoint_append(&checkpoint("cp-ok", Some("/文档/a.md"), "x"))
        .unwrap());
    let list = c.checkpoints().unwrap();
    assert_eq!(ids(&c), ["edge", "cp-ok"]);
    assert!(list.iter().all(wire_valid), "{list:?}");
}
