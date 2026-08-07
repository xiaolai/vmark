//! Inventory harness for the **verify-at-volume** track
//! (`dev-docs/grills/coherence/verify-at-volume-baseline.md`, Step 0).
//!
//! Reports how many version-stale edges are currently **candidates** for a
//! checker sweep, to drive the "sweep vs evolve" decision.
//!
//! ## What this does and does NOT touch
//!
//! It builds an **in-memory** index from the ledger, so it never opens or
//! mutates the workspace's `index.db` — that file is owned by the running app
//! and opening it read/write would run DDL and risk contention. Reading the
//! ledger can still quarantine malformed lines (a healing write); the ledger
//! is otherwise untouched, and the CAS is never written.
//!
//! ## Accepted limitations (deliberate — read the numbers with these in mind)
//!
//! - **No reconciliation, by design.** Production (`perform_breakdown_in`)
//!   calls `scan_workspace` first, which *mutates* the ledger (minting
//!   observed-external transformations). Doing that here would defeat the point
//!   of not touching workspace state, so this reports the ledger *as
//!   committed*: edits made outside the app since its last scan are invisible.
//!   Scan in the app first, then inventory.
//! - **Quarantine write.** `Ledger::read_all` moves malformed lines to
//!   quarantine — a healing write, and there is no quarantine-free public read.
//!   Re-implementing ledger parsing to dodge it would risk diverging from the
//!   kernel's own reader, so it is accepted and surfaced (`quarantined:` below).
//! - **`live-stale` is not "all live dependents".** The breakdown returns only
//!   live *non-fresh* edges, so a dependent that is currently fresh is not
//!   counted. Both ranking columns are labelled; neither is a dependent total.
//!
//! Candidate executability *is* checked: each candidate is verified to have its
//! three CAS texts present and UTF-8 before it counts toward SWEEP.
//!
//! Run:
//!   cargo test --manifest-path src-tauri/Cargo.toml \
//!     --test verify_at_volume_inventory -- --ignored --nocapture

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};

use vmark_lib::coherence::cas::SnapshotStore;
use vmark_lib::coherence::claims::ClaimStore;
use vmark_lib::coherence::contexts::{ContextSet, DEFAULT_CONTEXT_ID};
use vmark_lib::coherence::dag::Resolved;
use vmark_lib::coherence::index::CoherenceIndex;
use vmark_lib::coherence::index_row::{state_label, EdgeRow};
use vmark_lib::coherence::ledger::Ledger;
use vmark_lib::coherence::types::WriterId;

/// A sweep reaches volume once this many distinct edges are checkable.
const SWEEP_THRESHOLD: usize = 10;

/// Disk state of a registered object. `Unknown` is first-class: `exists()`
/// collapses permission errors into "absent", which would let an unreadable
/// corpus masquerade as a moved one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathState {
    Present,
    Absent,
    Unknown,
    /// Escapes the workspace (absolute or `..`) — never probed.
    Invalid,
}

/// Probe a registry path without following it out of the workspace. The ledger
/// is git-shared, so its paths are untrusted input.
fn probe(root: &Path, rel: &str) -> PathState {
    let p = Path::new(rel);
    // Mirror production's rule (`coherence::paths::resolve_workspace_rel`):
    // EVERY component must be `Normal`. Checking `is_absolute()` + `ParentDir`
    // was weaker than what ships, and the gap is platform-specific: Windows
    // does not consider "/etc/passwd" absolute (no drive letter, no UNC
    // prefix), so it fell through to a plain join and reported `Absent` where
    // production correctly rejects it on the non-`Normal` `RootDir` component.
    // Rejecting on components covers RootDir, Prefix, ParentDir and CurDir on
    // every platform, so the harness can no longer be laxer than the guard it
    // is meant to model.
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return PathState::Invalid;
    }
    let joined = root.join(p);
    match joined.try_exists() {
        Ok(false) => PathState::Absent,
        Err(_) => PathState::Unknown,
        // Present on disk — confirm a symlink hasn't escaped the workspace.
        Ok(true) => match (root.canonicalize(), joined.canonicalize()) {
            (Ok(r), Ok(full)) if full.starts_with(&r) => PathState::Present,
            (Ok(_), Ok(_)) => PathState::Invalid,
            _ => PathState::Unknown,
        },
    }
}

/// Can `prepare_check` actually run on this edge? It needs three texts —
/// upstream@pinned, upstream@current, downstream@rev — each present in the CAS
/// and UTF-8. `version-stale` only says the *graph* permits a check, so SWEEP
/// must be based on this, not on the raw candidate count.
fn is_executable(index: &CoherenceIndex, snapshots: &SnapshotStore, row: &EdgeRow) -> bool {
    let current = match index.resolve_live(&row.upstream) {
        Ok(Resolved::Single(rev)) => rev,
        _ => return false,
    };
    let needed = [
        (row.upstream, row.pinned.clone()),
        (row.upstream, current),
        (row.downstream, row.downstream_rev.clone()),
    ];
    for (object, revision) in needed {
        let Ok(Some(hash)) = index.content_hash_of(&object, &revision) else {
            return false;
        };
        match snapshots.get(&hash) {
            Ok(bytes) => {
                if String::from_utf8(bytes).is_err() {
                    return false;
                }
            }
            Err(_) => return false,
        }
    }
    true
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Verdict {
    EmptyRegistry,
    Sweep { checkable: usize },
    Indeterminate { unreadable: usize },
    WrongOrMovedCorpus { absent: usize, total: usize },
    EvolveCoherent { present: usize },
    EvolveInsufficient { checkable: usize, absent: usize },
}

/// Pure verdict classification — the decision this harness exists to make.
fn classify(
    checkable: usize,
    present: usize,
    absent: usize,
    unreadable: usize,
    registry_len: usize,
) -> Verdict {
    if registry_len == 0 {
        return Verdict::EmptyRegistry;
    }
    // Enough candidates is decisive regardless of the rest.
    if checkable >= SWEEP_THRESHOLD {
        return Verdict::Sweep { checkable };
    }
    // Never claim a corpus is missing (or coherent) while paths are unreadable.
    if unreadable > 0 {
        return Verdict::Indeterminate { unreadable };
    }
    if present == 0 && absent > 0 {
        return Verdict::WrongOrMovedCorpus {
            absent,
            total: registry_len,
        };
    }
    if checkable == 0 && absent == 0 {
        return Verdict::EvolveCoherent { present };
    }
    Verdict::EvolveInsufficient { checkable, absent }
}

// ---------------------------------------------------------------- unit tests

#[test]
fn empty_registry_is_not_a_coherent_corpus() {
    assert_eq!(classify(0, 0, 0, 0, 0), Verdict::EmptyRegistry);
}

#[test]
fn sweep_only_at_or_above_threshold() {
    assert_eq!(
        classify(SWEEP_THRESHOLD, 10, 0, 0, 10),
        Verdict::Sweep {
            checkable: SWEEP_THRESHOLD
        }
    );
    // One short must not claim SWEEP.
    assert!(matches!(
        classify(SWEEP_THRESHOLD - 1, 10, 0, 0, 10),
        Verdict::EvolveInsufficient { .. }
    ));
}

#[test]
fn sweep_wins_even_with_unreadable_paths() {
    assert_eq!(classify(12, 5, 0, 3, 8), Verdict::Sweep { checkable: 12 });
}

#[test]
fn unreadable_paths_block_a_definitive_verdict() {
    // Would otherwise look like a moved corpus; must stay indeterminate.
    assert_eq!(
        classify(0, 0, 4, 2, 6),
        Verdict::Indeterminate { unreadable: 2 }
    );
}

#[test]
fn all_absent_is_a_moved_corpus() {
    assert_eq!(
        classify(0, 0, 6, 0, 6),
        Verdict::WrongOrMovedCorpus {
            absent: 6,
            total: 6
        }
    );
}

#[test]
fn present_and_nothing_stale_is_coherent() {
    assert_eq!(
        classify(0, 10, 0, 0, 10),
        Verdict::EvolveCoherent { present: 10 }
    );
}

#[test]
fn partial_absence_is_insufficient_not_coherent() {
    assert!(matches!(
        classify(0, 7, 3, 0, 10),
        Verdict::EvolveInsufficient {
            checkable: 0,
            absent: 3
        }
    ));
}

#[test]
fn probe_rejects_paths_escaping_the_workspace() {
    let root = Path::new("/tmp/does-not-matter");
    assert_eq!(probe(root, "../outside.md"), PathState::Invalid);
    assert_eq!(probe(root, "/etc/passwd"), PathState::Invalid);
    assert_eq!(probe(root, "a/../../b.md"), PathState::Invalid);
}

/// The escape this actually guards: a relative path with no `..` that only
/// canonicalization can catch. Without the containment check this returns
/// `Present` and the harness happily probes outside the workspace.
#[cfg(unix)]
#[test]
fn probe_rejects_a_symlink_escaping_the_workspace() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!("vmark-probe-{}", std::process::id()));
    let root = base.join("workspace");
    let outside = base.join("outside");
    std::fs::create_dir_all(&root).expect("mk workspace");
    std::fs::create_dir_all(&outside).expect("mk outside");
    let target = outside.join("secret.md");
    std::fs::write(&target, b"x").expect("write target");
    let link = root.join("escape.md");
    let _ = std::fs::remove_file(&link);
    symlink(&target, &link).expect("symlink");

    assert_eq!(probe(&root, "escape.md"), PathState::Invalid);

    // A real file inside the workspace still resolves as Present.
    std::fs::write(root.join("inside.md"), b"y").expect("write inside");
    assert_eq!(probe(&root, "inside.md"), PathState::Present);

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn probe_reports_absent_for_a_missing_relative_path() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_eq!(probe(root, "definitely/not/here.md"), PathState::Absent);
    assert_eq!(probe(root, "Cargo.toml"), PathState::Present);
}

/// Exercises the SWEEP over-promise guard on a synthetic corpus: a candidate
/// only counts as executable when all three texts `prepare_check` needs are in
/// the CAS *and* are UTF-8. Without this the harness can promise a sweep of
/// candidates that cannot actually be checked.
#[test]
fn executable_requires_all_three_cas_texts_present_and_utf8() {
    use vmark_lib::coherence::project::EdgeState;
    use vmark_lib::coherence::types::{
        Agent, AgentType, Confidence, Envelope, InputRef, InputRole, Intent, ObjectId, OutputRef,
        RevisionId, Transformation,
    };

    let base = std::env::temp_dir().join(format!("vmark-cas-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let store = SnapshotStore::new(base.join("snapshots"));
    let empty_store = SnapshotStore::new(base.join("empty"));

    let writer = WriterId(uuid::Uuid::nil());
    let up = ObjectId(uuid::Uuid::now_v7());
    let down_text = ObjectId(uuid::Uuid::now_v7());
    let down_binary = ObjectId(uuid::Uuid::now_v7());

    let up_v1_hash = store.put_text("upstream v1").expect("put up v1");
    let up_v1 = RevisionId::compute(&up_v1_hash, &[]);
    let up_v2_hash = store.put_text("upstream v2").expect("put up v2");
    let up_v2 = RevisionId::compute(&up_v2_hash, std::slice::from_ref(&up_v1));
    let down_hash = store.put_text("downstream").expect("put down");
    let down_rev = RevisionId::compute(&down_hash, &[]);
    // Deliberately not valid UTF-8.
    let bin_hash = store.put_binary(&[0xff, 0xfe, 0x00]).expect("put binary");
    let bin_rev = RevisionId::compute(&bin_hash, &[]);

    let make = |inputs: Vec<InputRef>, outputs: Vec<OutputRef>| {
        let body = serde_json::to_value(Transformation {
            inputs,
            outputs,
            agent: Agent {
                kind: AgentType::Human,
                id: None,
            },
            intent: Intent {
                kind: "test".into(),
                summary: "fixture".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
        })
        .expect("serialize transformation");
        Envelope::create("transformation", writer, body)
    };

    let t_up_v1 = make(
        vec![],
        vec![OutputRef {
            object: up,
            revision: up_v1.clone(),
            content_hash: up_v1_hash,
            parents: vec![],
        }],
    );
    let t_down = make(
        vec![InputRef {
            object: up,
            revision: up_v1.clone(),
            role: InputRole::Direct,
            kind: vmark_lib::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        vec![OutputRef {
            object: down_text,
            revision: down_rev.clone(),
            content_hash: down_hash,
            parents: vec![],
        }],
    );
    let t_down_bin = make(
        vec![InputRef {
            object: up,
            revision: up_v1.clone(),
            role: InputRole::Direct,
            kind: vmark_lib::coherence::edge_kind::OriginEdgeKind::Dependency,
        }],
        vec![OutputRef {
            object: down_binary,
            revision: bin_rev.clone(),
            content_hash: bin_hash,
            parents: vec![],
        }],
    );
    // Advance the upstream so the edges are version-stale.
    let t_up_v2 = make(
        vec![],
        vec![OutputRef {
            object: up,
            revision: up_v2,
            content_hash: up_v2_hash,
            parents: vec![up_v1.clone()],
        }],
    );

    let (mut index, _) = CoherenceIndex::open_in_memory().expect("in-memory index");
    index
        .rebuild_from(&[t_up_v1, t_down.clone(), t_down_bin.clone(), t_up_v2])
        .expect("rebuild");

    let row = |txf_id, downstream, downstream_rev| EdgeRow {
        txf: txf_id,
        input: 0,
        upstream: up,
        upstream_path: None,
        pinned: up_v1.clone(),
        downstream,
        downstream_path: None,
        downstream_rev,
        confidence: "exact".into(),
        state: EdgeState::VersionStale,
        prior_waivers: 0,
        kind: "dependency".into(),
        frozen_downstream: false,
        anchor_status: None,
        actionable: true,
    };

    let text_row = row(t_down.id, down_text, down_rev);
    let binary_row = row(t_down_bin.id, down_binary, bin_rev);

    // All three texts present and UTF-8.
    assert!(
        is_executable(&index, &store, &text_row),
        "all CAS texts present and UTF-8 => executable"
    );
    // Same edge, but the CAS has none of the content.
    assert!(
        !is_executable(&index, &empty_store, &text_row),
        "missing CAS snapshots must not count toward SWEEP"
    );
    // Present in CAS, but the downstream is not UTF-8.
    assert!(
        !is_executable(&index, &store, &binary_row),
        "non-UTF-8 downstream must not count toward SWEEP"
    );

    let _ = std::fs::remove_dir_all(&base);
}

// ------------------------------------------------- real-repo smoke inventory

#[test]
#[ignore = "reads the repo's real .vmark ledger; run explicitly for the verify-at-volume inventory"]
fn inventory_checkable_stale_edges() {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf();
    let vmark = repo_root.join(".vmark");

    // Ledger -> in-memory index. The app's index.db is never opened.
    let ledger = Ledger::new(vmark.join("ledger"), WriterId(uuid::Uuid::nil()));
    let read = ledger.read_all().expect("read ledger");
    let (mut index, _) = CoherenceIndex::open_in_memory().expect("in-memory index");
    index.rebuild_from(&read.entries).expect("rebuild index");

    // Mirror perform_breakdown_in's context/fingerprint binding, so edges that
    // already carry a check are not miscounted as unchecked.
    let store = ClaimStore::from_entries(&read.entries);
    let contexts = ContextSet::load(&vmark.join("contexts"));
    let visible = contexts.effective_claims(DEFAULT_CONTEXT_ID);
    let fingerprint = store.claims_fingerprint(&visible);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let rows = index
        .breakdown_checked(&now, &DEFAULT_CONTEXT_ID.to_string(), &fingerprint)
        .expect("breakdown");

    let mut by_state: BTreeMap<String, usize> = BTreeMap::new();
    for r in &rows {
        *by_state.entry(state_label(&r.state)).or_default() += 1;
    }

    println!("\n=== verify-at-volume inventory (repo .vmark) ===");
    println!("workspace   : {}", repo_root.display());
    println!("as of       : {now}");
    println!("fingerprint : {fingerprint}");
    println!("quarantined : {}", read.quarantined.len());
    println!("live non-fresh edges: {}", rows.len());
    for (state, n) in &by_state {
        println!("  {state:22} {n}");
    }

    let snapshots = SnapshotStore::new(vmark.join("snapshots"));
    let candidates: Vec<&EdgeRow> = rows
        .iter()
        .filter(|r| state_label(&r.state) == "version-stale")
        .collect();
    let mut executable = 0usize;
    println!(
        "\ngraph candidates (version-stale, no applicable check): {}",
        candidates.len()
    );
    for r in &candidates {
        let up = r.upstream_path.as_deref().unwrap_or("<unregistered>");
        let down = r.downstream_path.as_deref().unwrap_or("<unregistered>");
        let runnable = is_executable(&index, &snapshots, r);
        if runnable {
            executable += 1;
        }
        let mark = if runnable {
            "executable"
        } else {
            "NOT executable — CAS snapshot missing or non-UTF-8"
        };
        println!("    {}#{}  {up}  ->  {down}   [{mark}]", r.txf, r.input);
    }
    println!("executable candidates (prepare_check can actually run): {executable}");

    // Registry disk state.
    let registry = index.registry_state().expect("registry state");
    let mut present = 0usize;
    let mut absent: Vec<String> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    for path in registry.path_of.values() {
        match probe(&repo_root, path) {
            PathState::Present => present += 1,
            PathState::Absent => absent.push(path.clone()),
            PathState::Unknown | PathState::Invalid => unreadable.push(path.clone()),
        }
    }
    absent.sort();
    unreadable.sort();
    println!(
        "\nregistered objects: {} ({present} present, {} absent, {} unreadable/invalid)",
        registry.path_of.len(),
        absent.len(),
        unreadable.len()
    );
    for p in absent.iter().chain(unreadable.iter()).take(20) {
        println!("    not usable: {p}");
    }

    // Two DIFFERENT signals — the historical count is not a live-dependent count.
    let mut historical: HashMap<String, usize> = HashMap::new();
    for env in &read.entries {
        if env.kind != "transformation" {
            continue;
        }
        if let Some(inputs) = env.body.get("inputs").and_then(|v| v.as_array()) {
            for inp in inputs {
                if let Some(obj) = inp.get("object").and_then(|v| v.as_str()) {
                    *historical.entry(obj.to_string()).or_default() += 1;
                }
            }
        }
    }
    let mut live_stale: HashMap<String, usize> = HashMap::new();
    for r in &rows {
        *live_stale.entry(r.upstream.0.to_string()).or_default() += 1;
    }
    let mut objs: Vec<(usize, usize, String)> = registry
        .path_of
        .iter()
        .map(|(oid, path)| {
            let key = oid.0.to_string();
            (
                *live_stale.get(&key).unwrap_or(&0),
                *historical.get(&key).unwrap_or(&0),
                path.clone(),
            )
        })
        .collect();
    objs.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    println!("\nupstream ranking  (live-stale = dependents currently stale on it;");
    println!("                   historical = input appearances across ALL history,");
    println!("                   including retired revisions — NOT a live count):");
    for (live, hist, path) in &objs {
        println!("  live-stale {live:>3}   historical {hist:>3}   {path}");
    }

    println!();
    match classify(
        executable,
        present,
        absent.len(),
        unreadable.len(),
        registry.path_of.len(),
    ) {
        Verdict::EmptyRegistry => println!(
            "VERDICT: NO CORPUS — the registry is empty; there is nothing to sweep or evolve."
        ),
        Verdict::Sweep { checkable } => println!(
            "VERDICT: SWEEP — {checkable} candidates (>= {SWEEP_THRESHOLD}). One sweep reaches volume."
        ),
        Verdict::Indeterminate { unreadable } => println!(
            "VERDICT: INDETERMINATE — {unreadable} registered path(s) unreadable/invalid; \
             refusing a corpus verdict until they resolve."
        ),
        Verdict::WrongOrMovedCorpus { absent, total } => println!(
            "VERDICT: WRONG/MOVED CORPUS — all {total} registered objects are missing ({absent}); \
             pick or restore a real corpus workspace."
        ),
        Verdict::EvolveCoherent { present } => println!(
            "VERDICT: EVOLVE FIRST (corpus is COHERENT) — {present} objects present, none stale. \
             Co-edit registered upstreams, re-scan in the app, then re-inventory."
        ),
        Verdict::EvolveInsufficient { checkable, absent } => println!(
            "VERDICT: EVOLVE FIRST — only {checkable} candidates (< {SWEEP_THRESHOLD}), {absent} object(s) absent. \
             Co-edit present upstreams, re-scan, then re-inventory."
        ),
    }
    println!();
}
