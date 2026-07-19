// Breakdown queries (spec §9.2 projection in the all-live default context),
// single-edge projection, and the delete→rebuild equivalence digest (R16).
//
// All-live ancestry shortcut (documented in the spike report): in a finite
// DAG every revision reaches some head; with exactly one head every other
// revision is a strict ancestor of it. So under the all-live context a
// direct edge classifies with NO ancestor walk:
//   multi-head upstream -> Diverged; pin == the single head -> Fresh;
//   otherwise -> VersionStale (modulo ratification/waiver records).
// The materialized head_anc closure and the BFS fallback (§9.3) are still
// exercised by the single-edge projector, which follows §9.2 literally.

use crate::model::{sha256_hex, ANC_MATERIALIZE_ABOVE};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::time::Instant;

/// Breakdown over ONLY the edges that produced each object's current head
/// revision(s) — the provenance of what the user sees now. This is the
/// semantics the WI-1.9 breakdown view needs.
pub const SQL_CURRENT: &str = "
SELECT e.txf, e.input_idx, uh.n, uh.h1, e.pinned, r.kind
FROM heads hd
CROSS JOIN edges e ON e.out_rev = hd.rev AND e.role = 0
JOIN obj_heads uh ON uh.object = e.upstream
LEFT JOIN resolved r ON r.txf = e.txf AND r.input_idx = e.input_idx AND r.against = uh.h1";

/// Stress variant: every direct edge in the ledger, historical ones included.
pub const SQL_ALL: &str = "
SELECT e.txf, e.input_idx, uh.n, uh.h1, e.pinned, r.kind
FROM edges e
JOIN obj_heads uh ON uh.object = e.upstream
LEFT JOIN resolved r ON r.txf = e.txf AND r.input_idx = e.input_idx AND r.against = uh.h1
WHERE e.role = 0";

pub struct Row {
    pub txf: String,
    pub input_idx: i64,
    pub state: u8,
}

/// §9.2 projection under all-live: resolution records are consulted before
/// the pin/selection comparison, matching the spec's order.
fn classify(n: i64, h1: Option<i64>, pinned: i64, res_kind: Option<i64>) -> u8 {
    if n > 1 {
        return 3; // resolve() returned DIVERGED_HEADS
    }
    let h1 = h1.expect("single-head object must have h1");
    match res_kind {
        Some(1) => 0, // ratified against current selection -> Fresh
        Some(2) => 2, // waived against current selection
        _ => {
            if pinned == h1 {
                0
            } else {
                1 // strict ancestor of the single head -> VersionStale
            }
        }
    }
}

pub fn breakdown(conn: &Connection, sql: &str) -> (Vec<Row>, [usize; 4]) {
    let mut stmt = conn.prepare_cached(sql).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut out: Vec<Row> = Vec::with_capacity(400_000);
    let mut counts = [0usize; 4];
    while let Some(r) = rows.next().unwrap() {
        let txf: String = r.get(0).unwrap();
        let input_idx: i64 = r.get(1).unwrap();
        let n: i64 = r.get(2).unwrap();
        let h1: Option<i64> = r.get(3).unwrap();
        let pinned: i64 = r.get(4).unwrap();
        let rk: Option<i64> = r.get(5).unwrap();
        let state = classify(n, h1, pinned, rk);
        counts[state as usize] += 1;
        out.push(Row { txf, input_idx, state });
    }
    (out, counts)
}

/// Warm timing: run twice untimed, then `runs` timed; returns (timings_us, last result).
pub fn timed_breakdown(conn: &Connection, sql: &str, runs: usize) -> (Vec<u128>, Vec<Row>, [usize; 4]) {
    for _ in 0..2 {
        let _ = breakdown(conn, sql);
    }
    let mut times = Vec::with_capacity(runs);
    let mut last = None;
    for _ in 0..runs {
        let t = Instant::now();
        let r = breakdown(conn, sql);
        times.push(t.elapsed().as_micros());
        last = Some(r);
    }
    let (rows, counts) = last.unwrap();
    (times, rows, counts)
}

/// Order-independent digest over (txf, input_idx, state) — the R16
/// delete→rebuild equivalence check compares these across rebuilds.
pub fn digest(rows: &mut [Row]) -> String {
    rows.sort_unstable_by(|a, b| (&a.txf, a.input_idx).cmp(&(&b.txf, b.input_idx)));
    let mut buf = String::with_capacity(rows.len() * 48);
    for r in rows.iter() {
        buf.push_str(&r.txf);
        buf.push('\t');
        buf.push_str(&r.input_idx.to_string());
        buf.push('\t');
        buf.push_str(&(r.state as i64).to_string());
        buf.push('\n');
    }
    sha256_hex(&[buf.as_bytes()])
}

/// Single-edge projector following §9.2 literally: materialized head_anc for
/// objects with > 64 revisions, naive BFS over parent links below that.
pub struct Projector<'c> {
    s_edge: rusqlite::Statement<'c>,
    s_heads: rusqlite::Statement<'c>,
    s_res: rusqlite::Statement<'c>,
    s_anc: rusqlite::Statement<'c>,
    s_parents: rusqlite::Statement<'c>,
}

impl<'c> Projector<'c> {
    pub fn new(conn: &'c Connection) -> Self {
        Projector {
            s_edge: conn
                .prepare("SELECT txf, input_idx, upstream, pinned FROM edges WHERE eid = ?1")
                .unwrap(),
            s_heads: conn.prepare("SELECT n, h1, revs FROM obj_heads WHERE object = ?1").unwrap(),
            s_res: conn
                .prepare("SELECT kind FROM resolved WHERE txf = ?1 AND input_idx = ?2 AND against = ?3")
                .unwrap(),
            s_anc: conn.prepare("SELECT 1 FROM head_anc WHERE head = ?1 AND anc = ?2").unwrap(),
            s_parents: conn.prepare("SELECT parent FROM parents WHERE rid = ?1").unwrap(),
        }
    }

    pub fn project(&mut self, eid: i64) -> u8 {
        let (txf, input_idx, upstream, pinned): (String, i64, i64, i64) = self
            .s_edge
            .query_row(params![eid], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        let (n, h1, revs): (i64, Option<i64>, i64) = self
            .s_heads
            .query_row(params![upstream], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        if n > 1 {
            return 3;
        }
        let h1 = h1.expect("single-head object must have h1");
        let rk: Option<i64> = self
            .s_res
            .query_row(params![txf, input_idx, h1], |r| r.get(0))
            .optional()
            .unwrap();
        match rk {
            Some(1) => 0,
            Some(2) => 2,
            _ => {
                if pinned == h1 {
                    0
                } else if revs > ANC_MATERIALIZE_ABOVE {
                    if self.s_anc.exists(params![h1, pinned]).unwrap() {
                        1
                    } else {
                        3
                    }
                } else if self.bfs_ancestor(h1, pinned) {
                    1
                } else {
                    3
                }
            }
        }
    }

    /// §9.3 naive path: BFS from the selection down parent links, looking
    /// for the pin. Bounded by the object's revision count (≤ 64 here).
    fn bfs_ancestor(&mut self, from: i64, target: i64) -> bool {
        let mut stack = vec![from];
        let mut seen: HashSet<i64> = HashSet::new();
        while let Some(r) = stack.pop() {
            let mut q = self.s_parents.query(params![r]).unwrap();
            while let Some(row) = q.next().unwrap() {
                let p: i64 = row.get(0).unwrap();
                if p == target {
                    return true;
                }
                if seen.insert(p) {
                    stack.push(p);
                }
            }
        }
        false
    }
}

/// Sample ~n direct-edge eids spread across the edges table.
pub fn sample_eids(conn: &Connection, n: usize) -> Vec<i64> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM edges WHERE role = 0", [], |r| r.get(0))
        .unwrap();
    let step = (total / n as i64).max(1);
    let mut stmt = conn
        .prepare("SELECT eid FROM edges WHERE role = 0 AND (eid % ?1) = 0 LIMIT ?2")
        .unwrap();
    let eids: Vec<i64> = stmt
        .query_map(params![step, n as i64], |r| r.get(0))
        .unwrap()
        .map(|x| x.unwrap())
        .collect();
    eids
}
