// Rebuild-from-scan: parse every JSONL ledger segment (order-independent,
// idem-deduplicated per spec §5.1) and build the disposable SQLite index.
// This is the R16 path; wall time here is the ≤10 s budget under test.

use crate::ledger_types::{Env, ResBody, TxfBody, SCHEMA};
use crate::model::ANC_MATERIALIZE_ABOVE;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Default)]
pub struct RebuildStats {
    pub total_ms: u128,
    pub scan_insert_ms: u128,
    pub derive_ms: u128,
    pub index_ms: u128,
    pub segments: usize,
    pub entries: usize,
    pub txf: usize,
    pub skipped_idem: usize,
    pub quarantined: usize,
    pub other_kinds: usize,
    pub revisions: usize,
    pub parents: usize,
    pub edges: usize,
    pub heads: usize,
    pub multi_head_objects: usize,
    pub head_anc_rows: usize,
    pub resolutions: usize,
    pub dangling_pins: usize,
    pub db_bytes: u64,
}

pub fn rebuild(ledger_dir: &Path, db_path: &Path) -> (Connection, RebuildStats) {
    if db_path.exists() {
        fs::remove_file(db_path).unwrap();
    }
    let t_total = Instant::now();
    let mut st = RebuildStats::default();

    let conn = Connection::open(db_path).unwrap();
    // The index is disposable by contract (R16), so durability pragmas are off
    // for the rebuild; a long-lived app connection would switch to WAL after.
    conn.pragma_update(None, "journal_mode", "OFF").unwrap();
    conn.pragma_update(None, "synchronous", "OFF").unwrap();
    conn.pragma_update(None, "cache_size", -262_144).unwrap(); // 256 MiB
    conn.pragma_update(None, "temp_store", "MEMORY").unwrap();
    conn.execute_batch(SCHEMA).unwrap();

    let mut files: Vec<PathBuf> = fs::read_dir(ledger_dir)
        .unwrap()
        .filter_map(|e| {
            let p = e.unwrap().path();
            (p.extension().and_then(|x| x.to_str()) == Some("jsonl")).then_some(p)
        })
        .collect();
    files.sort();
    st.segments = files.len();

    let mut oid_of: HashMap<String, i64> = HashMap::new();
    let mut rid_of: HashMap<(i64, String), i64> = HashMap::new();
    let mut rid_object: Vec<i64> = Vec::new();
    let mut rid_minted: Vec<bool> = Vec::new();
    let mut parent_pairs: Vec<(u32, u32)> = Vec::new();
    let mut idem_seen: HashSet<String> = HashSet::new();
    // (txf, input, against_rid) -> (time+id ordering key, kind 1=ratification 2=waiver)
    let mut resolved: HashMap<(String, u32, i64), (String, i64)> = HashMap::new();

    let t_scan = Instant::now();
    conn.execute_batch("BEGIN").unwrap();
    {
        let mut ins_obj = conn.prepare("INSERT INTO objects(oid, uuid) VALUES (?1, ?2)").unwrap();
        let mut ins_rev = conn
            .prepare("INSERT INTO revisions(rid, object, rev, txf) VALUES (?1, ?2, ?3, ?4)")
            .unwrap();
        let mut ins_par = conn.prepare("INSERT INTO parents(rid, parent) VALUES (?1, ?2)").unwrap();
        let mut ins_edge = conn
            .prepare("INSERT INTO edges(eid, txf, input_idx, upstream, pinned, downstream, out_rev, role) \
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
            .unwrap();
        let mut next_eid: i64 = 0;

        for f in &files {
            let data = fs::read_to_string(f).unwrap();
            for line in data.lines() {
                let env: Env = match serde_json::from_str(line) {
                    Ok(e) => e,
                    Err(_) => {
                        st.quarantined += 1;
                        continue;
                    }
                };
                st.entries += 1;
                if !idem_seen.insert(env.idem.to_string()) {
                    st.skipped_idem += 1;
                    continue;
                }
                match env.kind {
                    "transformation" => {
                        let body: TxfBody = serde_json::from_str(env.body.get()).unwrap();
                        st.txf += 1;
                        assert_eq!(body.outputs.len(), 1, "spike generates single-output txfs");
                        let out = &body.outputs[0];
                        let doid = intern_obj(&mut oid_of, out.object, &mut ins_obj);
                        let orid = intern_rev(&mut rid_of, &mut rid_object, &mut rid_minted, doid, out.revision);
                        rid_minted[orid as usize] = true;
                        ins_rev.execute(params![orid, doid, out.revision, env.id]).unwrap();
                        for p in &out.parents {
                            let prid = intern_rev(&mut rid_of, &mut rid_object, &mut rid_minted, doid, p);
                            parent_pairs.push((orid as u32, prid as u32));
                            ins_par.execute(params![orid, prid]).unwrap();
                        }
                        for (idx, inp) in body.inputs.iter().enumerate() {
                            let uoid = intern_obj(&mut oid_of, inp.object, &mut ins_obj);
                            let prid = intern_rev(&mut rid_of, &mut rid_object, &mut rid_minted, uoid, inp.revision);
                            let role: i64 = if inp.role == "direct" { 0 } else { 1 };
                            next_eid += 1;
                            ins_edge
                                .execute(params![next_eid, env.id, idx as i64, uoid, prid, doid, orid, role])
                                .unwrap();
                            st.edges += 1;
                        }
                    }
                    "ratification" | "waiver" => {
                        let body: ResBody = serde_json::from_str(env.body.get()).unwrap();
                        let uoid = intern_obj(&mut oid_of, body.upstream_object, &mut ins_obj);
                        let arid =
                            intern_rev(&mut rid_of, &mut rid_object, &mut rid_minted, uoid, body.resolved_against);
                        let kind: i64 = if env.kind == "ratification" { 1 } else { 2 };
                        let ord = format!("{}|{}", env.time, env.id);
                        let key = (body.edge.txf.to_string(), body.edge.input, arid);
                        let e = resolved.entry(key).or_insert_with(|| (ord.clone(), kind));
                        if ord > e.0 {
                            *e = (ord, kind);
                        }
                    }
                    _ => st.other_kinds += 1,
                }
            }
        }
    }
    st.scan_insert_ms = t_scan.elapsed().as_millis();

    // Derive heads, per-object head summary, materialized head-ancestry.
    let t_derive = Instant::now();
    {
        let n_rids = rid_object.len();
        let mut child_count = vec![0u32; n_rids];
        let mut parents_of: Vec<Vec<u32>> = vec![Vec::new(); n_rids];
        for &(r, p) in &parent_pairs {
            child_count[p as usize] += 1;
            parents_of[r as usize].push(p);
        }
        st.dangling_pins = rid_minted.iter().filter(|m| !**m).count();

        let n_objs = oid_of.len();
        let mut obj_rids: Vec<Vec<u32>> = vec![Vec::new(); n_objs];
        for (rid, &oid) in rid_object.iter().enumerate() {
            obj_rids[oid as usize].push(rid as u32);
        }

        let mut ins_head = conn.prepare("INSERT INTO heads(object, rev) VALUES (?1, ?2)").unwrap();
        let mut ins_oh = conn
            .prepare("INSERT INTO obj_heads(object, n, h1, revs) VALUES (?1, ?2, ?3, ?4)")
            .unwrap();
        let mut ins_anc = conn.prepare("INSERT INTO head_anc(head, anc) VALUES (?1, ?2)").unwrap();
        let mut visited: HashSet<u32> = HashSet::new();

        for (oid, rids) in obj_rids.iter().enumerate() {
            let heads: Vec<u32> =
                rids.iter().copied().filter(|&r| child_count[r as usize] == 0).collect();
            for &h in &heads {
                ins_head.execute(params![oid as i64, h as i64]).unwrap();
            }
            let h1: Option<i64> = (heads.len() == 1).then(|| heads[0] as i64);
            ins_oh.execute(params![oid as i64, heads.len() as i64, h1, rids.len() as i64]).unwrap();
            st.heads += heads.len();
            if heads.len() > 1 {
                st.multi_head_objects += 1;
            }
            if rids.len() as i64 > ANC_MATERIALIZE_ABOVE {
                for &h in &heads {
                    visited.clear();
                    let mut stack: Vec<u32> = parents_of[h as usize].clone();
                    while let Some(r) = stack.pop() {
                        if visited.insert(r) {
                            ins_anc.execute(params![h as i64, r as i64]).unwrap();
                            st.head_anc_rows += 1;
                            stack.extend(&parents_of[r as usize]);
                        }
                    }
                }
            }
        }

        let mut ins_res = conn
            .prepare("INSERT INTO resolved(txf, input_idx, against, kind) VALUES (?1, ?2, ?3, ?4)")
            .unwrap();
        for ((txf, input, arid), (_ord, kind)) in &resolved {
            ins_res.execute(params![txf, *input as i64, arid, kind]).unwrap();
            st.resolutions += 1;
        }
    }
    conn.execute_batch("COMMIT").unwrap();
    st.derive_ms = t_derive.elapsed().as_millis();

    let t_index = Instant::now();
    conn.execute_batch(
        "CREATE INDEX idx_edges_outrev ON edges(out_rev, role);
         CREATE INDEX idx_edges_txf ON edges(txf, input_idx);
         ANALYZE;",
    )
    .unwrap();
    st.index_ms = t_index.elapsed().as_millis();

    st.revisions = rid_object.len();
    st.parents = parent_pairs.len();
    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
    st.db_bytes = (page_count * page_size) as u64;
    st.total_ms = t_total.elapsed().as_millis();
    (conn, st)
}

fn intern_obj(map: &mut HashMap<String, i64>, uuid: &str,
              ins: &mut rusqlite::Statement) -> i64 {
    if let Some(&id) = map.get(uuid) {
        return id;
    }
    let id = map.len() as i64;
    map.insert(uuid.to_string(), id);
    ins.execute(params![id, uuid]).unwrap();
    id
}

fn intern_rev(map: &mut HashMap<(i64, String), i64>, rid_object: &mut Vec<i64>,
              rid_minted: &mut Vec<bool>, oid: i64, rev: &str) -> i64 {
    if let Some(&id) = map.get(&(oid, rev.to_string())) {
        return id;
    }
    let id = rid_object.len() as i64;
    map.insert((oid, rev.to_string()), id);
    rid_object.push(oid);
    rid_minted.push(false);
    id
}
