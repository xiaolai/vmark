// WI-1.5 — SQLite index (R16): materialized revisions/edges/resolutions/
// registry, incremental apply, rebuild-from-scan, schema-version reset,
// and THE R16 test: delete the index, rescan, identical query results.

use super::*;
use crate::coherence::types::{
    Actor, ActorType, Agent, AgentType, Confidence, ContentHash, EdgeRef, Envelope, InputRef,
    InputRole, Intent, ObjectId, ObjectRegistered, OutputRef, Resolution, RevisionId,
    Transformation, WriterId,
};
use serde_json::json;

const NOW: &str = "2026-07-18T12:00:00Z";

fn oid(n: u8) -> ObjectId {
    ObjectId(uuid::Uuid::from_u128(n as u128))
}
fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}
fn rev(n: u8, parents: &[RevisionId]) -> RevisionId {
    RevisionId::compute(&hash(n), parents)
}
fn writer() -> WriterId {
    WriterId(uuid::Uuid::from_u128(1))
}

fn txf_entry(time: &str, inputs: Vec<InputRef>, outputs: Vec<OutputRef>) -> Envelope {
    let t = Transformation {
        inputs,
        outputs,
        agent: Agent {
            kind: AgentType::Model,
            id: Some("test-model".into()),
        },
        intent: Intent {
            kind: "test".into(),
            summary: "test".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    };
    let mut e = Envelope::create(
        "transformation",
        writer(),
        serde_json::to_value(&t).unwrap(),
    );
    e.time = time.to_string();
    e
}

fn registered(object: ObjectId, path: &str, time: &str) -> Envelope {
    let r = ObjectRegistered {
        object,
        path: path.into(),
        schema: None,
        derived_from: None,
    };
    let mut e = Envelope::create(
        "object-registered",
        writer(),
        serde_json::to_value(&r).unwrap(),
    );
    e.time = time.to_string();
    e
}

/// Story: elena (obj 1) at e0->e1; scene (obj 2) written against e0.
struct Fixture {
    entries: Vec<Envelope>,
    e0: RevisionId,
    e1: RevisionId,
    txf_id: uuid::Uuid,
}

fn fixture() -> Fixture {
    let e0 = rev(0, &[]);
    let e1 = rev(1, std::slice::from_ref(&e0));
    let s0 = rev(10, &[]);
    let mut entries = vec![
        registered(oid(1), "elena.md", "2026-07-18T09:00:00Z"),
        registered(oid(2), "scene-12.md", "2026-07-18T09:00:01Z"),
        txf_entry(
            "2026-07-18T09:00:02Z",
            vec![],
            vec![OutputRef {
                object: oid(1),
                revision: e0.clone(),
                content_hash: hash(0),
                parents: vec![],
            }],
        ),
    ];
    let scene_txf = txf_entry(
        "2026-07-18T09:00:03Z",
        vec![InputRef {
            object: oid(1),
            revision: e0.clone(),
            role: InputRole::Direct,
        }],
        vec![OutputRef {
            object: oid(2),
            revision: s0.clone(),
            content_hash: hash(10),
            parents: vec![],
        }],
    );
    let txf_id = scene_txf.id;
    entries.push(scene_txf);
    entries.push(txf_entry(
        "2026-07-18T09:00:04Z",
        vec![],
        vec![OutputRef {
            object: oid(1),
            revision: e1.clone(),
            content_hash: hash(1),
            parents: vec![e0.clone()],
        }],
    ));
    Fixture {
        entries,
        e0,
        e1,
        txf_id,
    }
}

fn mem_index_with(entries: &[Envelope]) -> CoherenceIndex {
    let (mut idx, _) = CoherenceIndex::open_in_memory().unwrap();
    for e in entries {
        idx.apply_entry(e).unwrap();
    }
    idx
}

#[test]
fn upstream_advance_appears_in_breakdown() {
    let f = fixture();
    let idx = mem_index_with(&f.entries);
    let rows = idx.breakdown(NOW).unwrap();
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.upstream_path.as_deref(), Some("elena.md"));
    assert_eq!(row.downstream_path.as_deref(), Some("scene-12.md"));
    assert_eq!(row.pinned, f.e0);
    assert!(matches!(
        row.state,
        crate::coherence::project::EdgeState::VersionStale
    ));
}

#[test]
fn fresh_edges_are_not_listed() {
    let f = fixture();
    // Drop the elena e0->e1 advance: the scene edge is fresh.
    let idx = mem_index_with(&f.entries[..4]);
    assert!(idx.breakdown(NOW).unwrap().is_empty());
}

#[test]
fn ratification_clears_the_breakdown_row() {
    let f = fixture();
    let mut idx = mem_index_with(&f.entries);
    let r = Resolution {
        edge: EdgeRef {
            txf: f.txf_id,
            input: 0,
        },
        upstream_object: oid(1),
        pinned: f.e0.clone(),
        resolved_against: f.e1.clone(),
        actor: Actor {
            kind: ActorType::Human,
            id: "xiaolai".into(),
        },
        reason: None,
        expires: None,
    };
    let mut e = Envelope::create("ratification", writer(), serde_json::to_value(&r).unwrap());
    e.time = "2026-07-18T10:00:00Z".to_string();
    idx.apply_entry(&e).unwrap();
    assert!(
        idx.breakdown(NOW).unwrap().is_empty(),
        "ratified edge is fresh"
    );
}

#[test]
fn waiver_shows_as_waived_distinctly() {
    let f = fixture();
    let mut idx = mem_index_with(&f.entries);
    let r = Resolution {
        edge: EdgeRef {
            txf: f.txf_id,
            input: 0,
        },
        upstream_object: oid(1),
        pinned: f.e0.clone(),
        resolved_against: f.e1.clone(),
        actor: Actor {
            kind: ActorType::Human,
            id: "xiaolai".into(),
        },
        reason: Some("intentional".into()),
        expires: None,
    };
    let mut e = Envelope::create("waiver", writer(), serde_json::to_value(&r).unwrap());
    e.time = "2026-07-18T10:00:00Z".to_string();
    idx.apply_entry(&e).unwrap();
    let rows = idx.breakdown(NOW).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(matches!(
        rows[0].state,
        crate::coherence::project::EdgeState::Waived
    ));
}

#[test]
fn apply_entry_is_idempotent() {
    let f = fixture();
    let mut idx = mem_index_with(&f.entries);
    for e in &f.entries {
        idx.apply_entry(e).unwrap(); // replay everything
    }
    assert_eq!(idx.breakdown(NOW).unwrap().len(), 1);
}

#[test]
fn navigation_and_unknown_kinds_are_ignored() {
    let f = fixture();
    let mut idx = mem_index_with(&f.entries);
    idx.apply_entry(&Envelope::create(
        "navigation",
        writer(),
        json!({ "git": { "op": "checkout", "from": "a", "to": "b" } }),
    ))
    .unwrap();
    idx.apply_entry(&Envelope::create("hologram-sync", writer(), json!({})))
        .unwrap();
    assert_eq!(idx.breakdown(NOW).unwrap().len(), 1);
}

#[test]
fn delete_index_rescan_identical() {
    // THE R16 test: the index is strictly derived — deleting it loses
    // nothing; a rebuild from the plain-text ledger reproduces identical
    // query results.
    let f = fixture();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("index.db");

    let (mut idx, _) = CoherenceIndex::open(&db).unwrap();
    for e in &f.entries {
        idx.apply_entry(e).unwrap();
    }
    let before = idx.breakdown(NOW).unwrap();
    let heads_before = idx.heads(&oid(1)).unwrap();
    drop(idx);

    std::fs::remove_file(&db).unwrap();

    let (mut rebuilt, needs_rebuild) = CoherenceIndex::open(&db).unwrap();
    assert!(needs_rebuild, "fresh index must request a rescan");
    rebuilt.rebuild_from(&f.entries).unwrap();
    assert_eq!(rebuilt.breakdown(NOW).unwrap(), before);
    assert_eq!(rebuilt.heads(&oid(1)).unwrap(), heads_before);
}

#[test]
fn schema_version_mismatch_triggers_silent_reset() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("index.db");
    {
        let (mut idx, _) = CoherenceIndex::open(&db).unwrap();
        idx.apply_entry(&fixture().entries[0]).unwrap();
    }
    // Corrupt the schema version.
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.pragma_update(None, "user_version", 9999).unwrap();
    }
    let (idx, needs_rebuild) = CoherenceIndex::open(&db).unwrap();
    assert!(
        needs_rebuild,
        "version mismatch must reset and request rescan"
    );
    assert!(idx.breakdown(NOW).unwrap().is_empty(), "old data wiped");
}

#[test]
fn persistence_across_reopen_without_rebuild() {
    let f = fixture();
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("index.db");
    {
        let (mut idx, _) = CoherenceIndex::open(&db).unwrap();
        for e in &f.entries {
            idx.apply_entry(e).unwrap();
        }
    }
    let (idx, needs_rebuild) = CoherenceIndex::open(&db).unwrap();
    assert!(!needs_rebuild);
    assert_eq!(idx.breakdown(NOW).unwrap().len(), 1);
}

#[test]
fn heads_come_from_the_materialized_dag() {
    let f = fixture();
    let idx = mem_index_with(&f.entries);
    assert_eq!(idx.heads(&oid(1)).unwrap(), vec![f.e1.clone()]);
    assert_eq!(idx.heads(&oid(99)).unwrap(), Vec::<RevisionId>::new());
}
