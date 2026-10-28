// WI-AL1.7 — the history panel's document list (`agent_journal_history`):
// revisions newest first with their full attribution (the four principal
// states, the connection and the session label kept apart), the save's
// initiator, the tool, the revision time; blocked live hunks as
// "Blocked: reason (origin)" anchored on their lastCertified revision; a
// bounded list; a key the journal never saw is not minted by a read.
// WI-AL2.1b — every live hunk as the writer persisted it: one row per hunk,
// with its geometry, never regrouped.
use std::sync::Arc;
use std::time::Duration;

use super::controller::Controller;
use super::degraded_drain::{Backoff, DrainScheduler};
use super::doc_registry::DocRegistry;
use super::test_support::*;
use crate::agent_journal::controller_doc_history::HISTORY_ROWS;
use crate::agent_journal::writer::Writer;

const KEY: &str = "path:/a.md";

fn controller() -> (tempfile::TempDir, Controller, Arc<Writer>, Arc<DocRegistry>) {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs: Arc<DocRegistry> = Arc::default();
    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(w.clone(), docs.clone(), Arc::new(drains));
    (dir, c, w, docs)
}

fn history(c: &Controller, key: &str) -> serde_json::Value {
    let out = c
        .history(&serde_json::json!({ "docKey": key }).to_string())
        .expect("history");
    serde_json::to_value(out).unwrap()
}

/// A controlled write by `actor` (wire JSON) on top of the head.
fn write_as(
    c: &Controller,
    actor: serde_json::Value,
    parent: Option<&str>,
    pre: &str,
    post: &str,
) -> String {
    let p = serde_json::json!({
        "docKey": KEY, "parent": parent, "preimage": pre, "actor": actor, "tool": "document.write",
    });
    let txn = c.prepare(&p.to_string()).expect("prepare").txn.to_string();
    let out = c
        .commit(&txn, &serde_json::json!({ "postimage": post }).to_string())
        .expect("commit");
    serde_json::to_value(out).unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn mcp(principal: serde_json::Value, label: Option<&str>) -> serde_json::Value {
    let mut a = serde_json::json!({
        "type": "mcp",
        "principal": principal,
        "connectionId": uuid::Uuid::new_v4().to_string(),
    });
    if let Some(l) = label {
        a["sessionLabel"] = serde_json::json!(l);
    }
    a
}

#[test]
fn rows_are_newest_first_with_attribution_tool_kind_and_time() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let saved = human_save(&w, doc, "hello");
    let actor = mcp(
        serde_json::json!({ "state": "provider", "provider": "claude" }),
        Some("review pass"),
    );
    let wrote = write_as(
        &c,
        actor.clone(),
        Some(&saved.to_string()),
        "hello",
        "hello world",
    );

    let h = history(&c, KEY);
    let rows = h["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["revision"], wrote, "newest first");
    assert_eq!(rows[0]["kind"], "controlled");
    assert_eq!(rows[0]["tool"], "document.write");
    assert_eq!(rows[0]["actor"]["principal"]["provider"], "claude");
    assert_eq!(rows[0]["actor"]["connectionId"], actor["connectionId"]);
    assert_eq!(rows[0]["actor"]["sessionLabel"], "review pass");
    assert!(
        rows[0]["at"].as_u64().unwrap() > 0,
        "the revision's time is the record's"
    );
    assert_eq!(rows[1]["revision"], saved.to_string());
    assert_eq!(rows[1]["kind"], "observed");
    assert_eq!(rows[1]["actor"]["type"], "human");
    assert!(rows[1]["tool"].is_null(), "a save has no tool");
    assert!(
        rows[1]["initiator"].is_object(),
        "a save names who asked for it"
    );
    assert_eq!(h["truncated"], false);
    assert_eq!(h["generation"], w.generation().to_string());
}

#[test]
fn the_four_principal_states_stay_distinct_on_the_wire() {
    let (_dir, c, _w, _docs) = controller();
    let states = [
        serde_json::json!({ "state": "anonymous" }),
        serde_json::json!({ "state": "unrecognized" }),
        serde_json::json!({ "state": "ambiguous" }),
        serde_json::json!({ "state": "provider", "provider": "codex" }),
    ];
    let mut parent: Option<String> = None;
    let mut text = String::new();
    for (i, s) in states.iter().enumerate() {
        let next = format!("{text}{i}");
        parent = Some(write_as(
            &c,
            mcp(s.clone(), None),
            parent.as_deref(),
            &text,
            &next,
        ));
        text = next;
    }
    let h = history(&c, KEY);
    let seen: Vec<_> = h["rows"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .map(|r| r["actor"]["principal"].clone())
        .collect();
    assert_eq!(
        seen, states,
        "anonymous, unrecognized, ambiguous and provider are never collapsed"
    );
}

#[test]
fn a_blocked_live_hunk_reads_reason_and_origin_at_its_last_certified_revision() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    let (_, agent_rev) = agent_change(
        &w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    let barrier = snapshot_save(&w, doc, "abXc!");

    let span = {
        let s = w.snapshot().state;
        s.docs[&doc].hunks.values().next().unwrap().clone()
    };
    let block = span
        .span
        .block
        .clone()
        .expect("the snapshot-only save blocks the live hunk");
    let h = history(&c, KEY);
    let blocked = h["blocked"].as_array().unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0]["reason"], "snapshotOnly");
    assert_eq!(blocked[0]["origin"], block.origin);
    assert_eq!(blocked[0]["state"], "pending");
    assert_eq!(blocked[0]["target"], agent_rev.to_string());
    assert_eq!(blocked[0]["blockedAt"], barrier.to_string());
    let certified = span
        .span
        .last_certified
        .expect("a certified predecessor")
        .at;
    assert_eq!(blocked[0]["lastCertified"], certified.to_string());
    // A blocked range is no evidence of where the hunk is: no current span.
    let live = h["hunks"].as_array().unwrap();
    assert_eq!(live.len(), 1);
    assert_eq!(live[0]["span"], serde_json::Value::Null, "{}", live[0]);
    let rows = h["rows"].as_array().unwrap();
    assert!(
        rows.iter().any(|r| r["revision"] == certified.to_string()),
        "the lastCertified revision is a row the panel can highlight"
    );
}

#[test]
fn a_certified_hunk_is_not_listed_as_blocked() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    agent_change(
        &w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    assert!(history(&c, KEY)["blocked"].as_array().unwrap().is_empty());
}

#[test]
fn the_list_is_bounded_and_says_so() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let mut last = None;
    for i in 0..=HISTORY_ROWS {
        last = Some(snapshot_save(&w, doc, &format!("v{i}")));
    }
    let h = history(&c, KEY);
    assert_eq!(h["rows"].as_array().unwrap().len(), HISTORY_ROWS);
    assert_eq!(h["truncated"], true);
    assert_eq!(h["rows"][0]["revision"], last.unwrap().to_string());
}

#[test]
fn another_document_and_an_unknown_key_list_nothing_and_mint_no_id() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "mine");
    assert!(history(&c, "path:/b.md")["rows"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(
        docs.find("path:/b.md").unwrap().is_none(),
        "a read never mints a document id"
    );
    assert!(
        c.history("{\"docKey\": \"\"}").is_err(),
        "an empty key is refused"
    );
    assert!(c.history("not json").is_err());
}

#[test]
fn a_row_names_its_parent_so_the_panel_can_restore_what_came_before() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let saved = human_save(&w, doc, "hello");
    let wrote = write_as(
        &c,
        mcp(serde_json::json!({ "state": "anonymous" }), None),
        Some(&saved.to_string()),
        "hello",
        "hi",
    );
    let h = history(&c, KEY);
    assert_eq!(h["rows"][0]["revision"], wrote);
    assert_eq!(h["rows"][0]["parent"], saved.to_string());
    assert!(
        h["rows"][1]["parent"].is_null(),
        "the first revision's parent is genesis"
    );
}

#[test]
fn a_last_certified_revision_beyond_the_cap_is_still_listed() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    agent_change(
        &w,
        doc,
        "abc",
        "abXc",
        Edit {
            at: 2,
            delete: 0,
            insert: 1,
        },
    );
    snapshot_save(&w, doc, "abXc!");
    for i in 0..=HISTORY_ROWS {
        snapshot_save(&w, doc, &format!("abXc!{i}"));
    }
    let h = history(&c, KEY);
    let certified = h["blocked"][0]["lastCertified"]
        .as_str()
        .expect("certified")
        .to_owned();
    let rows = h["rows"].as_array().unwrap();
    assert_eq!(h["truncated"], true);
    assert!(
        rows.iter().any(|r| r["revision"] == certified.as_str()),
        "a blocked hunk's lastCertified revision stays reachable past the cap"
    );
    assert!(
        rows.len() <= HISTORY_ROWS + 3,
        "only referenced revisions ride past the cap"
    );
    let seqs: Vec<u64> = rows
        .iter()
        .map(|r| r["seq"].as_str().unwrap().parse().unwrap())
        .collect();
    assert!(seqs.windows(2).all(|p| p[0] > p[1]), "still newest first");
}

#[test]
fn not_truncated_when_only_referenced_revisions_lie_past_the_cap() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let (_, agent_rev) = agent_change(
        &w,
        doc,
        "",
        "X",
        Edit {
            at: 0,
            delete: 0,
            insert: 1,
        },
    );
    snapshot_save(&w, doc, "X!");
    // Two revisions above, so exactly one (the oldest, the blocked hunk's
    // target) lies past the cap.
    for i in 0..HISTORY_ROWS - 1 {
        snapshot_save(&w, doc, &format!("X!{i}"));
    }
    let h = history(&c, KEY);
    assert_eq!(h["blocked"][0]["target"], agent_rev.to_string());
    assert_eq!(h["rows"].as_array().unwrap().len(), HISTORY_ROWS + 1);
    assert_eq!(
        h["truncated"], false,
        "every revision is listed, so nothing older was omitted"
    );
}

#[test]
fn a_document_with_a_queued_record_reads_degraded() {
    let dir = tmp();
    let (w, faults) = open_fast(dir.path());
    let w = Arc::new(w);
    let docs: Arc<DocRegistry> = Arc::default();
    let slow = DrainScheduler::new(Backoff {
        first: Duration::from_secs(600),
        max: Duration::from_secs(600),
    });
    let c = Controller::new(w.clone(), docs.clone(), Arc::new(slow));
    let txn = {
        let p = serde_json::json!({
            "docKey": KEY, "parent": null, "preimage": "",
            "actor": mcp(serde_json::json!({ "state": "anonymous" }), None), "tool": "document.write",
        });
        c.prepare(&p.to_string()).expect("prepare").txn.to_string()
    };
    assert_eq!(history(&c, KEY)["degraded"], false);
    // The commit and the drain's first, immediate retry both fail; the next
    // retry is minutes away, so the record stays queued for the read.
    faults.fail_next_appends(5);
    let out = c
        .commit(&txn, &serde_json::json!({ "postimage": "x" }).to_string())
        .expect("commit");
    assert!(!out.durable, "the commit was applied but not recorded");
    assert_eq!(
        history(&c, KEY)["degraded"],
        true,
        "the queued record is visible to the panel"
    );
    assert_eq!(
        history(&c, "path:/other.md")["degraded"],
        false,
        "only that document"
    );
}

#[test]
fn every_live_hunk_is_listed_as_the_writer_persisted_it() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    // Three touching one-unit hunks of one revision: a client that grouped
    // hunks would show one row.
    seed_hunks(&w, doc, 3);
    let s = w.snapshot().state;
    let mut persisted: Vec<_> = s.docs[&doc]
        .hunks
        .values()
        .map(|h| {
            (
                h.hunk.id.0.clone(),
                h.hunk.target.to_string(),
                h.hunk.target_range.start,
                h.hunk.target_range.end,
            )
        })
        .collect();
    persisted.sort_by_key(|p| p.2);
    assert_eq!(persisted.len(), 3);
    let h = history(&c, KEY);
    let listed: Vec<_> = h["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            assert_eq!(r["state"], "pending");
            assert_eq!(r["kind"], "change");
            assert_eq!(r["baseRange"], r["targetRange"]);
            (
                r["hunkId"].as_str().unwrap().to_owned(),
                r["target"].as_str().unwrap().to_owned(),
                r["targetRange"]["from"].as_u64().unwrap(),
                r["targetRange"]["to"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        listed, persisted,
        "one row per persisted hunk, in document order"
    );
}

#[test]
fn hunks_list_newest_revision_first_and_omit_settled_ones() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    let edit = Edit {
        at: 2,
        delete: 0,
        insert: 1,
    };
    let (_, older) = agent_change(&w, doc, "abc", "abXc", edit);
    let edit = Edit {
        at: 0,
        delete: 0,
        insert: 1,
    };
    let (_, newer) = agent_change(&w, doc, "abXc", "YabXc", edit);
    let h = history(&c, KEY);
    let targets: Vec<_> = h["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["target"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(targets, [newer.to_string(), older.to_string()]);
}

#[test]
fn an_unknown_key_lists_no_hunks() {
    let (_dir, c, _w, _docs) = controller();
    assert_eq!(
        history(&c, "path:/never.md")["hunks"],
        serde_json::json!([])
    );
}

// WI-AL2.3 — what the review panel decides against: each live hunk's
// reviewGen (a decimal string), its mapped span and its edited-since flag,
// as the projection holds them, and the document head the decision's CAS
// names.
#[test]
fn a_hunk_row_carries_the_review_gen_span_and_edited_since_it_is_decided_against() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "abc");
    let edit = Edit {
        at: 2,
        delete: 0,
        insert: 1,
    };
    agent_change(&w, doc, "abc", "abXc", edit);
    // A person retypes the agent's text: the span is edited since.
    human_edit(
        &w,
        doc,
        "abZc",
        &[Edit {
            at: 2,
            delete: 1,
            insert: 1,
        }],
    );
    let s = w.snapshot().state;
    let h = history(&c, KEY);
    let rows = h["hunks"].as_array().unwrap();
    assert!(!rows.is_empty(), "{h:#}");
    for row in rows {
        let id = row["hunkId"].as_str().unwrap();
        let live = s.docs[&doc]
            .hunks
            .values()
            .find(|l| l.hunk.id.0 == id)
            .expect("listed hunk is live");
        assert_eq!(row["reviewGen"], live.review_gen.to_string(), "{row:#}");
        assert_eq!(row["span"], serde_json::to_value(live.span.range).unwrap());
        assert_eq!(row["editedSince"], live.span.edited_since);
    }
    assert!(
        rows.iter().any(|r| r["editedSince"] == true),
        "the retyped span reads edited since: {h:#}"
    );
}

#[test]
fn the_reply_names_the_head_and_an_unknown_key_reads_null() {
    let (_dir, c, w, docs) = controller();
    let doc = docs.resolve(KEY).unwrap();
    let saved = human_save(&w, doc, "abc");
    assert_eq!(history(&c, KEY)["head"], saved.to_string());
    assert_eq!(w.head(doc), Some(saved));
    let unknown = history(&c, "path:/never.md");
    assert!(unknown["head"].is_null(), "{unknown:#}");
    assert!(unknown.as_object().unwrap().contains_key("head"));
}
