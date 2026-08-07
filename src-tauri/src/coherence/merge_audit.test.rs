// WI-5.1 — merge-affected edge set, end-to-end: a real git merge whose changed
// files map (via the registry) to objects and thence to the edges to re-check.

use super::*;
use crate::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent,
    ObjectRegistered, OutputRef, RevisionId, Transformation, WriterId,
};

fn hash(n: u8) -> ContentHash {
    ContentHash::parse(&format!("sha256:{}", format!("{n:02x}").repeat(32))).unwrap()
}

fn run_git(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git {args:?}");
}

fn registered(writer: WriterId, object: ObjectId, path: &str) -> Envelope {
    Envelope::create(
        "object-registered",
        writer,
        serde_json::to_value(ObjectRegistered {
            object,
            path: path.into(),
            schema: None,
            derived_from: None,
        })
        .unwrap(),
    )
}

fn txf(writer: WriterId, object: ObjectId, n: u8, inputs: Vec<(ObjectId, RevisionId)>) -> Envelope {
    let revision = RevisionId::compute(&hash(n), &[]);
    Envelope::create(
        "transformation",
        writer,
        serde_json::to_value(Transformation {
            inputs: inputs
                .into_iter()
                .map(|(object, revision)| InputRef {
                    object,
                    revision,
                    role: InputRole::Direct,
                    kind: crate::coherence::edge_kind::OriginEdgeKind::Dependency,
                })
                .collect(),
            outputs: vec![OutputRef {
                object,
                revision,
                content_hash: hash(n),
                parents: vec![],
            }],
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "seed".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .unwrap(),
    )
}

#[test]
fn merge_affected_edges_maps_changed_files_to_incident_edges() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // A real merge touching feat.md (feature side) and main.md (main side).
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("base.md"), "base\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    run_git(root, &["checkout", "-q", "-b", "feature"]);
    std::fs::write(root.join("feat.md"), "feature\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "feat"]);
    run_git(root, &["checkout", "-q", "main"]);
    std::fs::write(root.join("main.md"), "main\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "main"]);
    run_git(root, &["merge", "-q", "--no-ff", "-m", "merge", "feature"]);

    // An index: U -> feat_obj (feat.md derived from U); main_obj registered but
    // has no edge; base_obj registered, untouched by the merge.
    let (mut index, _) = CoherenceIndex::open_in_memory().unwrap();
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = ObjectId(uuid::Uuid::now_v7());
    let feat = ObjectId(uuid::Uuid::now_v7());
    let main = ObjectId(uuid::Uuid::now_v7());
    let base = ObjectId(uuid::Uuid::now_v7());
    let u1 = RevisionId::compute(&hash(1), &[]);
    index
        .rebuild_from(&[
            registered(writer, u, "canon.md"),
            registered(writer, feat, "feat.md"),
            registered(writer, main, "main.md"),
            registered(writer, base, "base.md"),
            txf(writer, u, 1, vec![]),
            txf(writer, feat, 2, vec![(u, u1)]), // edge U -> feat_obj
        ])
        .unwrap();

    let edges = merge_affected_edges(&index, root).expect("audit");
    // The merge changed feat.md + main.md. feat_obj is incident to the U->feat
    // edge; main_obj has no edge; base.md was untouched. So exactly one edge.
    assert_eq!(
        edges.len(),
        1,
        "the U -> feat edge is the merge-affected set"
    );
    assert_eq!(edges[0].downstream, feat);
    assert_eq!(edges[0].upstream, u);
}

#[test]
fn no_merge_yields_no_affected_edges() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("a.md"), "x\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let (index, _) = CoherenceIndex::open_in_memory().unwrap();
    assert!(merge_affected_edges(&index, root).unwrap().is_empty());
}
