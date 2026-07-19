// Spike S2 (WI-0.6) — rusqlite bundled: rebuild-from-scan + breakdown query
// budgets from dev-docs/specs/coherence-format-v0.md §10.
//
// Usage: s2-rusqlite-spike [work-base-dir] [results-json-path]
//   work-base-dir defaults to the system temp dir; a fresh
//   `s2-rusqlite-spike/` subdir is created (and wiped) under it.

mod gen_support;
mod generate;
mod ledger_types;
mod model;
mod query;
mod rebuild;
mod rng;

use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

fn pct(mut v: Vec<u128>, p: f64) -> u128 {
    v.sort_unstable();
    v[((v.len() as f64 - 1.0) * p) as usize]
}

fn main() {
    let base = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let results_path = std::env::args().nth(2).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("results.json"));
    let work = base.join("s2-rusqlite-spike");
    if work.exists() {
        fs::remove_dir_all(&work).unwrap();
    }
    let ledger = work.join("ledger");
    fs::create_dir_all(&ledger).unwrap();
    let db_path = work.join("index.db");
    let mut r = rng::Rng::new(0xC0FF_EE5E_ED00_0001);

    println!("[gen] synthesizing workspace ledger at spec §10 scale ...");
    let g = generate::generate(&ledger, &mut r);
    println!(
        "[gen] {} entries ({} txf, {} roots), {} edges ({} direct), {} segments, {:.1} MiB, {} ms",
        g.entries, g.txf, g.root_txf, g.edges_total, g.edges_direct, g.segments,
        g.ledger_bytes as f64 / (1024.0 * 1024.0), g.gen_ms
    );
    println!(
        "[gen] revisions/object p50={} p95={} max={}; multi-head objects={}",
        g.rev_p50, g.rev_p95, g.rev_max, g.multi_head_objects
    );

    println!("[rebuild #1] scanning {} segments -> {} ...", g.segments, db_path.display());
    let (conn, rb1) = rebuild::rebuild(&ledger, &db_path);
    println!(
        "[rebuild #1] total {} ms (scan+insert {}, derive {}, index {}); db {:.1} MiB; dangling pins {}",
        rb1.total_ms, rb1.scan_insert_ms, rb1.derive_ms, rb1.index_ms,
        rb1.db_bytes as f64 / (1024.0 * 1024.0), rb1.dangling_pins
    );

    let sqlite_version: String =
        conn.query_row("SELECT sqlite_version()", [], |row| row.get(0)).unwrap();

    println!("[query] breakdown (current-head edges, WI-1.9 semantics), warm x5 ...");
    let (t_cur, mut rows_cur, c_cur) = query::timed_breakdown(&conn, query::SQL_CURRENT, 5);
    println!("[query] rows={} states={:?} times_us={:?}", rows_cur.len(), c_cur, t_cur);

    println!("[query] breakdown (ALL direct edges, stress variant), warm x5 ...");
    let (t_all, mut rows_all, c_all) = query::timed_breakdown(&conn, query::SQL_ALL, 5);
    println!("[query] rows={} states={:?} times_us={:?}", rows_all.len(), c_all, t_all);

    println!("[query] single-edge projection over 1000 sampled direct edges ...");
    let eids = query::sample_eids(&conn, 1000);
    let mut proj = query::Projector::new(&conn);
    for &e in eids.iter().take(100) {
        let _ = proj.project(e); // warm
    }
    let mut proj_times: Vec<u128> = Vec::with_capacity(eids.len());
    let mut proj_states: Vec<(i64, u8)> = Vec::with_capacity(eids.len());
    for &e in &eids {
        let t = Instant::now();
        let s = proj.project(e);
        proj_times.push(t.elapsed().as_micros());
        proj_states.push((e, s));
    }
    let proj_mean = proj_times.iter().sum::<u128>() as f64 / proj_times.len() as f64;
    let (proj_p50, proj_p95, proj_max) = (
        pct(proj_times.clone(), 0.50),
        pct(proj_times.clone(), 0.95),
        *proj_times.iter().max().unwrap(),
    );
    println!(
        "[query] projection us: mean={:.1} p50={} p95={} max={}",
        proj_mean, proj_p50, proj_p95, proj_max
    );

    // Cross-check: projector (closure/BFS path) must agree with the
    // set-based breakdown on every sampled edge.
    let by_edge: HashMap<(String, i64), u8> = {
        let mut m = HashMap::new();
        let mut stmt = conn.prepare("SELECT txf, input_idx FROM edges WHERE eid = ?1").unwrap();
        for &(eid, s) in &proj_states {
            let (txf, idx): (String, i64) =
                stmt.query_row([eid], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
            m.insert((txf, idx), s);
        }
        m
    };
    let mut proj_mismatch = 0usize;
    for row in &rows_all {
        if let Some(&s) = by_edge.get(&(row.txf.clone(), row.input_idx)) {
            if s != row.state {
                proj_mismatch += 1;
            }
        }
    }
    println!("[check] projector vs breakdown mismatches: {}", proj_mismatch);

    let digest1_cur = query::digest(&mut rows_cur);
    let digest1_all = query::digest(&mut rows_all);
    drop(proj);
    drop(conn);

    println!("[rebuild #2] delete index.db -> rebuild -> re-query (R16 equivalence) ...");
    fs::remove_file(&db_path).unwrap();
    let (conn2, rb2) = rebuild::rebuild(&ledger, &db_path);
    println!("[rebuild #2] total {} ms", rb2.total_ms);
    let (mut rows_cur2, _) = query::breakdown(&conn2, query::SQL_CURRENT);
    let (mut rows_all2, _) = query::breakdown(&conn2, query::SQL_ALL);
    let digest2_cur = query::digest(&mut rows_cur2);
    let digest2_all = query::digest(&mut rows_all2);
    let equivalent = digest1_cur == digest2_cur && digest1_all == digest2_all;
    println!("[check] delete->rebuild equivalence: {}", if equivalent { "IDENTICAL" } else { "MISMATCH" });
    assert!(equivalent, "R16 equivalence failed");

    let rebuild_worst_ms = rb1.total_ms.max(rb2.total_ms);
    let bd_cur_med_us = pct(t_cur.clone(), 0.5);
    let bd_all_med_us = pct(t_all.clone(), 0.5);
    let pass_rebuild = rebuild_worst_ms <= 10_000;
    let pass_bd_cur = bd_cur_med_us <= 100_000;
    let pass_bd_all = bd_all_med_us <= 100_000;
    let pass_proj = proj_p95 <= 1_000;

    let results = json!({
        "spike": "S2 rusqlite (bundled) — coherence index rebuild + breakdown budgets",
        "date": "2026-07-18",
        "build": "cargo run --release",
        "environment": {
            "sqlite_version": sqlite_version,
            "sqlite_linkage": "bundled (rusqlite `bundled` feature)",
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        },
        "scale": {
            "objects": model::N_OBJECTS,
            "ledger_entries": g.entries,
            "transformations": g.txf,
            "input_references_total": g.edges_total,
            "input_references_direct": g.edges_direct,
            "revisions_per_object": {"p50": g.rev_p50, "p95": g.rev_p95, "max": g.rev_max},
            "multi_head_objects": g.multi_head_objects,
            "writers": model::N_WRITERS,
            "segments": g.segments,
            "ledger_bytes": g.ledger_bytes
        },
        "generation": {"ms": g.gen_ms, "note": "not part of any budget"},
        "rebuild_1": {
            "total_ms": rb1.total_ms,
            "scan_insert_ms": rb1.scan_insert_ms,
            "derive_ms": rb1.derive_ms,
            "index_ms": rb1.index_ms,
            "rows": {"revisions": rb1.revisions, "parents": rb1.parents, "edges": rb1.edges,
                      "heads": rb1.heads, "head_anc": rb1.head_anc_rows, "resolved": rb1.resolutions},
            "entries_parsed": rb1.entries, "quarantined": rb1.quarantined,
            "idem_deduped": rb1.skipped_idem, "dangling_pins": rb1.dangling_pins,
            "db_bytes": rb1.db_bytes
        },
        "rebuild_2": {"total_ms": rb2.total_ms},
        "breakdown_current_heads": {
            "rows": rows_cur2.len(),
            "states": {"fresh": c_cur[0], "version_stale": c_cur[1], "waived": c_cur[2], "diverged": c_cur[3]},
            "warm_runs_us": t_cur, "median_us": bd_cur_med_us
        },
        "breakdown_all_edges": {
            "rows": rows_all2.len(),
            "states": {"fresh": c_all[0], "version_stale": c_all[1], "waived": c_all[2], "diverged": c_all[3]},
            "warm_runs_us": t_all, "median_us": bd_all_med_us
        },
        "single_edge_projection": {
            "samples": eids.len(), "mean_us": proj_mean,
            "p50_us": proj_p50, "p95_us": proj_p95, "max_us": proj_max,
            "mismatches_vs_breakdown": proj_mismatch
        },
        "equivalence_check": {
            "identical": equivalent,
            "digest_current": digest1_cur, "digest_all": digest1_all
        },
        "budgets": {
            "rebuild_le_10s": {"measured_ms": rebuild_worst_ms, "pass": pass_rebuild},
            "breakdown_current_le_100ms": {"measured_us": bd_cur_med_us, "pass": pass_bd_cur},
            "breakdown_all_le_100ms": {"measured_us": bd_all_med_us, "pass": pass_bd_all},
            "projection_le_1ms": {"measured_p95_us": proj_p95, "pass": pass_proj}
        }
    });
    fs::write(&results_path, serde_json::to_string_pretty(&results).unwrap()).unwrap();
    println!("[done] results written to {}", results_path.display());
    println!(
        "[verdict] rebuild {} ms (<=10000: {}), breakdown current {} us (<=100000: {}), \
         breakdown all {} us (<=100000: {}), projection p95 {} us (<=1000: {}), equivalence {}",
        rebuild_worst_ms, pass_rebuild, bd_cur_med_us, pass_bd_cur,
        bd_all_med_us, pass_bd_all, proj_p95, pass_proj, equivalent
    );
}
