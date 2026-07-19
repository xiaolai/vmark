//! Read-only inventory harness for the **verify-at-volume** track
//! (`dev-docs/grills/coherence/verify-at-volume-baseline.md`, Step 0).
//!
//! Opens the repo's own `.vmark` coherence ledger and reports how many
//! version-stale edges are currently **checkable** — the input to the
//! "sweep vs evolve" decision, computed by the kernel's own `breakdown()`
//! (not an approximation). Touches only the disposable index; the ledger
//! and CAS are read-only.
//!
//! Run:
//!   cargo test --manifest-path src-tauri/Cargo.toml \
//!     --test verify_at_volume_inventory -- --ignored --nocapture

use std::collections::BTreeMap;
use std::path::PathBuf;

use vmark_lib::coherence::index_row::state_label;
use vmark_lib::coherence::state::WorkspaceKernel;
use vmark_lib::coherence::types::WriterId;

#[test]
#[ignore = "reads the repo's real .vmark; run explicitly for the verify-at-volume inventory"]
fn inventory_checkable_stale_edges() {
    // Repo root = the crate's parent directory (src-tauri/..).
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf();

    // Writer id is irrelevant for a read-only breakdown.
    let kernel = WorkspaceKernel::open(&repo_root, WriterId(uuid::Uuid::nil()))
        .expect("open workspace kernel");

    // "now" safely after the ledger's latest entry (the corpus spans to 2026-07-19).
    const NOW: &str = "2026-07-19T23:59:59Z";
    let rows = kernel.index().breakdown(NOW).expect("breakdown");

    let mut by_state: BTreeMap<String, usize> = BTreeMap::new();
    for r in &rows {
        *by_state.entry(state_label(&r.state)).or_default() += 1;
    }

    println!("\n=== verify-at-volume inventory (repo .vmark) ===");
    println!("workspace: {}", repo_root.display());
    println!("live non-fresh edges: {}", rows.len());
    for (state, n) in &by_state {
        println!("  {state:22} {n}");
    }

    // Checkable = version-stale with no check result yet. These are what a
    // checker sweep runs on. (stale-* already carry a check result;
    // diverged / unpinnable are uncheckable — `prepare_check` refuses them.)
    let checkable = *by_state.get("version-stale").unwrap_or(&0);
    println!("\ncheckable (version-stale, no check yet): {checkable}");
    for r in rows
        .iter()
        .filter(|r| state_label(&r.state) == "version-stale")
    {
        let up = r
            .upstream_path
            .clone()
            .unwrap_or_else(|| r.upstream.0.to_string());
        let down = r
            .downstream_path
            .clone()
            .unwrap_or_else(|| r.downstream.0.to_string());
        println!("    {}#{}  {up}  ->  {down}", r.txf, r.input);
    }

    // Diagnose a 0/low count: coherent corpus (all fresh/resolved) vs. absent
    // objects (files not at their registered path → their edges are hidden,
    // spec §9.4). registry_state gives the object→path map; check disk.
    let registry = kernel.index().registry_state().expect("registry state");
    let mut present = 0usize;
    let mut absent: Vec<String> = Vec::new();
    for path in registry.path_of.values() {
        if repo_root.join(path).exists() {
            present += 1;
        } else {
            absent.push(path.clone());
        }
    }
    absent.sort();
    println!(
        "\nregistered objects: {} ({present} present, {} absent)",
        registry.path_of.len(),
        absent.len()
    );
    for p in absent.iter().take(20) {
        println!("    absent: {p}  (its edges are hidden, spec §9.4)");
    }

    // Verdict (gate: >= 10 distinct checkable edges reaches volume in one sweep).
    println!();
    if checkable >= 10 {
        println!("VERDICT: SWEEP — {checkable} checkable edges (>= 10). One checker sweep reaches volume.");
    } else if !absent.is_empty() && present == 0 {
        println!(
            "VERDICT: WRONG/MOVED CORPUS — 0 checkable, and all {} registered objects are absent \
             on disk. This ledger's files are gone; pick or restore a real corpus workspace.",
            registry.path_of.len()
        );
    } else if checkable == 0 && absent.is_empty() {
        println!(
            "VERDICT: EVOLVE FIRST (corpus is COHERENT) — {present} objects present, none stale. \
             Co-edit registered upstreams so dependents go stale, then re-inventory."
        );
    } else {
        println!(
            "VERDICT: EVOLVE FIRST — only {checkable} checkable edges (< 10; {} of {} objects absent). \
             Co-edit present upstreams to stale dependents, then re-inventory.",
            absent.len(),
            registry.path_of.len()
        );
    }
    println!();
}
