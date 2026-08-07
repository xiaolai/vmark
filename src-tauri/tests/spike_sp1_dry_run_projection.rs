//! Spike SP1 — dry-run projection over a disposable clone (plan WI-0.1).
//!
//! Proves ADR-P1 / design-runtime.md D2: previewing a candidate revision by
//! overlaying it on a *clone* of the revision DAG yields the SAME projection —
//! the multiset of `(SemanticEdgeKey, Option<EdgeState>)` over the affected
//! edge set — as building the DAG that a real commit would produce, while the
//! committed store is left byte-unchanged (mints nothing).
//!
//! The old plan formulation ("byte-identical to `commit → project → rollback`")
//! is retired: the ledger is append-only, so there is no rollback. The faithful
//! property is *observational multiset equality over a disposable clone*.
//!
//! Two independent code paths reach the projected graph. PREVIEW clones the
//! base DAG and calls `record_output(candidate)`; COMMIT replays a fresh
//! `RevisionDag` from base outputs plus the candidate in ledger order, exactly
//! as `rebuild_from` would. Equality of their projections over the affected set
//! is the load-bearing claim. Fixtures: linear restale, downstream retirement
//! (`Some → None` liveness change, D2), a divergence-creating candidate, and a
//! comparison against a real committed `CoherenceIndex.breakdown`.
//!
//! Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
//! spike_sp1_dry_run_projection -- --nocapture`

use std::collections::BTreeMap;
use std::path::Path;

use vmark_lib::coherence::cas::SnapshotStore;
use vmark_lib::coherence::dag::{ContextView, RevisionDag};
use vmark_lib::coherence::index::CoherenceIndex;
use vmark_lib::coherence::ledger::Ledger;
use vmark_lib::coherence::project::{project_edge, EdgeState, OriginEdge};
use vmark_lib::coherence::types::{
    Agent, AgentType, Confidence, ContentHash, Envelope, InputRef, InputRole, Intent, ObjectId,
    OutputRef, RevisionId, Transformation, WriterId,
};

const NOW: &str = "2026-07-20T00:00:00Z";

/// A produced output: which object, at which revision, over which parents.
struct Out {
    object: ObjectId,
    revision: RevisionId,
    content_hash: ContentHash,
    parents: Vec<RevisionId>,
}

/// One transformation: inputs (direct edges) producing exactly one output.
struct Txf {
    inputs: Vec<(ObjectId, RevisionId)>,
    out: Out,
}

fn rev(store: &SnapshotStore, content: &str, parents: &[RevisionId]) -> (RevisionId, ContentHash) {
    let hash = store.put_text(content).expect("cas put");
    (RevisionId::compute(&hash, parents), hash)
}

/// Build the transformation envelope a commit of `txf` would append.
fn envelope(writer: WriterId, txf: &Txf) -> Envelope {
    let body = serde_json::to_value(Transformation {
        inputs: txf
            .inputs
            .iter()
            .map(|(object, revision)| InputRef {
                object: *object,
                revision: revision.clone(),
                role: InputRole::Direct,
                kind: vmark_lib::coherence::edge_kind::OriginEdgeKind::Dependency,
            })
            .collect(),
        outputs: vec![OutputRef {
            object: txf.out.object,
            revision: txf.out.revision.clone(),
            content_hash: txf.out.content_hash.clone(),
            parents: txf.out.parents.clone(),
        }],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "test".into(),
            summary: "sp1".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
    })
    .expect("serialize");
    Envelope::create("transformation", writer, body)
}

/// Record a transformation's output into a DAG (what `rebuild_from` does).
fn record(dag: &mut RevisionDag, txf: &Txf) {
    dag.record_output(
        txf.out.object,
        txf.out.revision.clone(),
        txf.out.parents.clone(),
    );
}

/// The origin edges a transformation contributes (one per direct input).
fn edges_of(txf: &Txf) -> Vec<OriginEdge> {
    txf.inputs
        .iter()
        .enumerate()
        .map(|(i, (upstream, pinned))| OriginEdge {
            txf: uuid::Uuid::now_v7(),
            input: i as u32,
            upstream: *upstream,
            pinned: pinned.clone(),
            downstream: txf.out.object,
            downstream_rev: txf.out.revision.clone(),
            role: InputRole::Direct,
            kind: vmark_lib::coherence::edge_kind::OriginEdgeKind::Dependency,
        })
        .collect()
}

/// SemanticEdgeKey per the plan: a *bag* key over
/// (upstream, pinned, downstream, downstream_rev, role, input_ordinal).
fn semantic_key(e: &OriginEdge) -> String {
    format!(
        "{}|{}|{}|{}|{:?}|{}",
        e.upstream.0,
        e.pinned.as_str(),
        e.downstream.0,
        e.downstream_rev.as_str(),
        e.role,
        e.input
    )
}

/// Project the affected edge set over a DAG into a multiset keyed by
/// (SemanticEdgeKey, projected state). BTreeMap<key, count> = a multiset with
/// deterministic ordering.
fn project_multiset(edges: &[OriginEdge], dag: &RevisionDag) -> BTreeMap<String, usize> {
    let ctx = ContextView::all_live();
    let mut ms = BTreeMap::new();
    for e in edges {
        let state = project_edge(e, &ctx, dag, &[], &[], NOW);
        let key = format!("{}=>{:?}", semantic_key(e), state);
        *ms.entry(key).or_insert(0) += 1;
    }
    ms
}

/// Check-independent structural class of a projected state (design v4.3): the
/// four version-stale-with-a-verdict states collapse to one `Stale` token so a
/// semantic check can never change the class. Used to compare an overlay
/// projection against a real committed-index `breakdown` — which drops Fresh
/// edges and carries whatever check verdict happens to apply.
fn structural(state: Option<&EdgeState>) -> &'static str {
    match state {
        None => "Retired",
        Some(EdgeState::Fresh { .. }) => "Fresh",
        Some(EdgeState::VersionStale)
        | Some(EdgeState::StaleValid)
        | Some(EdgeState::StaleContradicted)
        | Some(EdgeState::StaleUnknown) => "Stale",
        Some(EdgeState::Waived) => "Waived",
        Some(EdgeState::Diverged { multi_head }) => {
            if *multi_head {
                "Diverged(multi)"
            } else {
                "Diverged"
            }
        }
        Some(EdgeState::Unpinnable) => "Unpinnable",
    }
}

/// Overlay projection as a **non-fresh** structural multiset — the shape a real
/// committed-index `breakdown` returns (it filters Fresh and retired edges).
fn overlay_structural_nonfresh(edges: &[OriginEdge], dag: &RevisionDag) -> BTreeMap<String, usize> {
    let ctx = ContextView::all_live();
    let mut ms = BTreeMap::new();
    for e in edges {
        let state = project_edge(e, &ctx, dag, &[], &[], NOW);
        let class = structural(state.as_ref());
        if class == "Fresh" || class == "Retired" {
            continue; // breakdown() omits both
        }
        *ms.entry(format!("{}=>{class}", semantic_key(e)))
            .or_insert(0) += 1;
    }
    ms
}

/// Run one fixture: assert preview-over-clone == commit-rebuild, that the
/// clone did not mutate the base DAG, and that persisting the base corpus and
/// then previewing leaves the ledger bytes untouched.
fn assert_observational_equality(label: &str, base: &[Txf], candidate: &Txf) {
    // Affected set (D2): every base edge whose upstream OR downstream is the
    // object the candidate changes, plus any edges the candidate itself adds.
    let changed = candidate.out.object;
    let mut affected: Vec<OriginEdge> = base
        .iter()
        .flat_map(edges_of)
        .filter(|e| e.upstream == changed || e.downstream == changed)
        .collect();
    affected.extend(edges_of(candidate));

    // Base DAG (the "committed store" before the candidate).
    let mut base_dag = RevisionDag::default();
    for t in base {
        record(&mut base_dag, t);
    }
    let base_heads_before: Vec<_> = base_dag.heads(&changed);

    // PREVIEW: clone + overlay. Mutates only the clone.
    let mut preview_dag = base_dag.clone();
    record(&mut preview_dag, candidate);
    let preview = project_multiset(&affected, &preview_dag);

    // The clone must not have disturbed the base DAG.
    assert_eq!(
        base_heads_before,
        base_dag.heads(&changed),
        "[{label}] cloning + overlay mutated the base DAG",
    );

    // COMMIT: an independent fresh rebuild from base + candidate, ledger order.
    let mut commit_dag = RevisionDag::default();
    for t in base {
        record(&mut commit_dag, t);
    }
    record(&mut commit_dag, candidate);
    let commit = project_multiset(&affected, &commit_dag);

    assert_eq!(
        preview, commit,
        "[{label}] preview projection differs from committed projection",
    );

    // "Mints nothing" — a real on-disk assertion. Persist the base corpus to a
    // real ledger, snapshot the file bytes, run the whole preview again, and
    // assert the ledger file is byte-identical afterwards.
    let base_dir = std::env::temp_dir().join(format!("vmark-sp1-{}-{}", label, std::process::id()));
    let _ = std::fs::remove_dir_all(&base_dir);
    let writer = WriterId(uuid::Uuid::now_v7());
    let ledger = Ledger::new(base_dir.join("ledger"), writer);
    for t in base {
        ledger.append(&envelope(writer, t)).expect("append base");
    }
    let ledger_dir = base_dir.join("ledger");
    let before = dir_bytes(&ledger_dir);
    // Preview again — pure, must touch nothing on disk.
    let mut preview_dag2 = base_dag.clone();
    record(&mut preview_dag2, candidate);
    let _ = project_multiset(&affected, &preview_dag2);
    let after = dir_bytes(&ledger_dir);
    assert_eq!(
        before, after,
        "[{label}] preview mutated the ledger on disk"
    );
    let _ = std::fs::remove_dir_all(&base_dir);
}

/// Concatenated bytes of every file under `dir`, in sorted path order.
fn dir_bytes(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut paths: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for p in paths {
            if p.is_file() {
                out.push((
                    p.file_name().unwrap().to_string_lossy().into_owned(),
                    std::fs::read(&p).unwrap_or_default(),
                ));
            }
        }
    }
    out
}

fn store_for(tag: &str) -> SnapshotStore {
    let dir = std::env::temp_dir().join(format!("vmark-sp1-cas-{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    SnapshotStore::new(dir)
}

#[test]
fn linear_restale_preview_equals_commit() {
    // U@u1 → D@d1. Candidate revises U to u2 (child of u1): the edge
    // U@u1→D@d1 must read VersionStale identically in preview and commit.
    let store = store_for("linear");
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let (u1, u1h) = rev(&store, "upstream v1", &[]);
    let (d1, d1h) = rev(&store, "downstream v1", &[]);
    let (u2, u2h) = rev(&store, "upstream v2", std::slice::from_ref(&u1));

    let base = vec![
        Txf {
            inputs: vec![],
            out: Out {
                object: u,
                revision: u1.clone(),
                content_hash: u1h,
                parents: vec![],
            },
        },
        Txf {
            inputs: vec![(u, u1.clone())],
            out: Out {
                object: d,
                revision: d1,
                content_hash: d1h,
                parents: vec![],
            },
        },
    ];
    let candidate = Txf {
        inputs: vec![],
        out: Out {
            object: u,
            revision: u2,
            content_hash: u2h,
            parents: vec![u1],
        },
    };
    assert_observational_equality("linear", &base, &candidate);
}

#[test]
fn downstream_retirement_preview_equals_commit() {
    // U@u1 → D@d1. Candidate revises the DOWNSTREAM D to d2: resolve(D) becomes
    // d2 ≠ d1, so the edge retires (project → None). Preview must see the same
    // Some → None liveness change the commit does (D2's downstream-incident set).
    let store = store_for("retire");
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let (u1, u1h) = rev(&store, "upstream v1", &[]);
    let (d1, d1h) = rev(&store, "downstream v1", &[]);
    let (d2, d2h) = rev(&store, "downstream v2", std::slice::from_ref(&d1));

    let base = vec![
        Txf {
            inputs: vec![],
            out: Out {
                object: u,
                revision: u1.clone(),
                content_hash: u1h,
                parents: vec![],
            },
        },
        Txf {
            inputs: vec![(u, u1)],
            out: Out {
                object: d,
                revision: d1.clone(),
                content_hash: d1h,
                parents: vec![],
            },
        },
    ];
    let candidate = Txf {
        inputs: vec![],
        out: Out {
            object: d,
            revision: d2,
            content_hash: d2h,
            parents: vec![d1],
        },
    };
    assert_observational_equality("retire", &base, &candidate);
}

#[test]
fn divergence_creating_candidate_preview_equals_commit() {
    // U@u1 → D@d1. Candidate revises U to u2b, ALSO a child of u1, while the
    // committed head is u2a (a sibling). resolve(U) becomes DivergedHeads, so
    // the edge reads Diverged{multi_head} identically in preview and commit.
    let store = store_for("diverge");
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let (u1, u1h) = rev(&store, "upstream v1", &[]);
    let (d1, d1h) = rev(&store, "downstream v1", &[]);
    let (u2a, u2ah) = rev(&store, "upstream v2a", std::slice::from_ref(&u1));
    let (u2b, u2bh) = rev(&store, "upstream v2b", std::slice::from_ref(&u1));

    let base = vec![
        Txf {
            inputs: vec![],
            out: Out {
                object: u,
                revision: u1.clone(),
                content_hash: u1h,
                parents: vec![],
            },
        },
        Txf {
            inputs: vec![(u, u1.clone())],
            out: Out {
                object: d,
                revision: d1,
                content_hash: d1h,
                parents: vec![],
            },
        },
        Txf {
            inputs: vec![],
            out: Out {
                object: u,
                revision: u2a,
                content_hash: u2ah,
                parents: vec![u1.clone()],
            },
        },
    ];
    let candidate = Txf {
        inputs: vec![],
        out: Out {
            object: u,
            revision: u2b,
            content_hash: u2bh,
            parents: vec![u1],
        },
    };
    assert_observational_equality("diverge", &base, &candidate);
}

/// Strengthened claim (G-B round-3 High #D): the clone-overlay preview matches
/// what a **real committed `CoherenceIndex`** produces via `breakdown`, not just
/// a hand-built DAG. COMMIT side = an in-memory index rebuilt from the actual
/// transformation envelopes (base + candidate) → `breakdown` (the shipped
/// projection code path). PREVIEW side = a base DAG cloned and overlaid with the
/// candidate, projected. Compared as non-fresh structural-class multisets
/// (v4.3), so a check verdict cannot perturb the comparison.
#[test]
fn overlay_matches_real_committed_index() {
    let store = store_for("real-index");
    let writer = WriterId(uuid::Uuid::now_v7());
    let u = ObjectId(uuid::Uuid::now_v7());
    let d = ObjectId(uuid::Uuid::now_v7());
    let (u1, u1h) = rev(&store, "upstream v1", &[]);
    let (d1, d1h) = rev(&store, "downstream v1", &[]);
    let (u2, u2h) = rev(&store, "upstream v2", std::slice::from_ref(&u1));

    let base = vec![
        Txf {
            inputs: vec![],
            out: Out {
                object: u,
                revision: u1.clone(),
                content_hash: u1h,
                parents: vec![],
            },
        },
        Txf {
            inputs: vec![(u, u1.clone())],
            out: Out {
                object: d,
                revision: d1,
                content_hash: d1h,
                parents: vec![],
            },
        },
    ];
    let candidate = Txf {
        inputs: vec![],
        out: Out {
            object: u,
            revision: u2,
            content_hash: u2h,
            parents: vec![u1],
        },
    };

    // Affected non-fresh set over the clone-overlay (PREVIEW).
    let mut affected: Vec<OriginEdge> = base
        .iter()
        .flat_map(edges_of)
        .filter(|e| e.upstream == u || e.downstream == u)
        .collect();
    affected.extend(edges_of(&candidate));
    let mut base_dag = RevisionDag::default();
    for t in &base {
        record(&mut base_dag, t);
    }
    let mut preview_dag = base_dag.clone();
    record(&mut preview_dag, &candidate);
    let preview = overlay_structural_nonfresh(&affected, &preview_dag);

    // COMMIT side: a REAL in-memory index rebuilt from the actual envelopes.
    let mut entries: Vec<_> = base.iter().map(|t| envelope(writer, t)).collect();
    entries.push(envelope(writer, &candidate));
    let (mut index, _) = CoherenceIndex::open_in_memory().expect("index");
    index.rebuild_from(&entries).expect("rebuild");
    let rows = index.breakdown(NOW).expect("breakdown");

    let mut committed: BTreeMap<String, usize> = BTreeMap::new();
    for r in &rows {
        // breakdown returns only live non-fresh direct edges (role Direct).
        let key = format!(
            "{}|{}|{}|{}|Direct|{}=>{}",
            r.upstream.0,
            r.pinned.as_str(),
            r.downstream.0,
            r.downstream_rev.as_str(),
            r.input,
            structural(Some(&r.state)),
        );
        *committed.entry(key).or_insert(0) += 1;
    }

    assert_eq!(
        preview, committed,
        "clone-overlay preview must equal the real committed index's breakdown"
    );
    // And the real index projects exactly the one restaled edge.
    assert_eq!(
        rows.len(),
        1,
        "expected one version-stale edge after commit"
    );
    assert_eq!(structural(Some(&rows[0].state)), "Stale");
}
