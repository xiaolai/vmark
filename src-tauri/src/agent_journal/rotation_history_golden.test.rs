// WI-AL2.1b — the history panel's input from the writer: ab12cd → aX12Yd by document.write, then a person's insert between the runs; the controller's doc-history reply lists the two runs as two hunks and is the golden fixture the TypeScript panel test renders, so a drift on either side fails
//! The reply is normalized before comparing: revision ids, the hunk ids
//! derived from them, the connection id and revision times are minted per
//! run, so they become stable placeholders. Everything else is compared as the controller wrote it.
//! `VMARK_WRITE_GOLDEN=1` rewrites the fixture; the default only checks.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::super::support::*;
use crate::agent_journal::controller::Controller;
use crate::agent_journal::degraded_drain::{Backoff, DrainScheduler};
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use serde_json::Value;

const FIXTURE: &str = "docHistoryAb12cd.json";
/// The time every revision is given in the fixture.
const AT: u64 = 1_767_268_800_000;

fn fixture() -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/agentJournal")
        .join(FIXTURE)
}

/// `v` with every string in `ids` replaced by its placeholder, times fixed.
fn normalize(v: &Value, ids: &HashMap<String, String>) -> Value {
    match v {
        Value::String(s) => Value::String(ids.get(s).cloned().unwrap_or_else(|| s.clone())),
        Value::Array(a) => Value::Array(a.iter().map(|x| normalize(x, ids)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| match k.as_str() {
                    "at" => (k.clone(), Value::from(AT)),
                    _ => (k.clone(), normalize(x, ids)),
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Placeholders for the reply's revision ids (oldest first), its hunk ids
/// (in the reply's order) and its connection ids.
fn placeholders(reply: &Value) -> HashMap<String, String> {
    let mut rows: Vec<&Value> = reply["rows"].as_array().unwrap().iter().collect();
    rows.sort_by_key(|r| r["seq"].as_str().unwrap().parse::<u64>().unwrap());
    let mut ids = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        ids.insert(
            r["revision"].as_str().unwrap().to_owned(),
            format!("rev-{}", i + 1),
        );
        for who in ["actor", "initiator"] {
            if let Some(c) = r[who]["connectionId"].as_str() {
                let n = ids.values().filter(|p| p.starts_with("conn-")).count();
                ids.entry(c.to_owned()).or_insert(format!("conn-{}", n + 1));
            }
        }
    }
    for (i, h) in reply["hunks"].as_array().unwrap().iter().enumerate() {
        ids.insert(
            h["hunkId"].as_str().unwrap().to_owned(),
            format!("hunk-{}", i + 1),
        );
    }
    ids
}

#[test]
fn the_doc_history_reply_for_two_runs_and_a_human_insert_matches_the_golden_fixture() {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let w: Arc<Writer> = Arc::new(w);
    let docs: Arc<DocRegistry> = Arc::default();
    let doc = docs.resolve(KEY).unwrap();
    human_save(&w, doc, "ab12cd");
    let sub = |at| Edit {
        at,
        delete: 1,
        insert: 1,
    };
    let req = Req {
        certificate: Some(cert("ab12cd", "aX12Yd", &[sub(1), sub(4)])),
        tool: "document.write",
        ..Req::new(w.head(doc), "ab12cd")
    };
    let out = commit(&w, prepare(&w, &docs, req).unwrap().txn, "aX12Yd", None).unwrap();
    assert!(out.certified, "{out:?}");
    let ins = Edit {
        at: 3,
        delete: 0,
        insert: 1,
    };
    human_edit(&w, doc, "aX1!2Yd", &[ins]);

    let drains = DrainScheduler::new(Backoff {
        first: Duration::from_millis(1),
        max: Duration::from_millis(4),
    });
    let c = Controller::new(w.clone(), docs.clone(), Arc::new(drains));
    let reply = c
        .history(&serde_json::json!({ "docKey": KEY }).to_string())
        .expect("history");
    let reply = serde_json::to_value(reply).unwrap();
    assert_eq!(reply["hunks"].as_array().unwrap().len(), 2, "{reply:#}");
    let got = normalize(&reply, &placeholders(&reply));

    let path = fixture();
    if std::env::var_os("VMARK_WRITE_GOLDEN").is_some() {
        std::fs::write(&path, serde_json::to_string_pretty(&got).unwrap() + "\n").unwrap();
    }
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("golden fixture {} missing: {e}", path.display()));
    let want: Value = serde_json::from_str(&text).expect("golden fixture is JSON");
    assert_eq!(
        got, want,
        "the doc-history reply drifted from {FIXTURE}; rerun with VMARK_WRITE_GOLDEN=1 and update the panel test"
    );
}
