// Synthetic workspace generator: writes real JSONL ledger segments
// (spec §5.3 envelope, §5.4 entry kinds) at spec §10 target scale.
// Generation time is measured separately and is NOT part of the rebuild budget.

use crate::gen_support::{ensure_dir, revision_counts, sample_k, GenStats, SegWriter};
use crate::model::*;
use crate::rng::Rng;
use serde_json::json;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

struct ObjState {
    revs: Vec<String>,
    heads: Vec<u32>,
}

pub fn generate(ledger_dir: &Path, rng: &mut Rng) -> GenStats {
    ensure_dir(ledger_dir);
    let t0 = Instant::now();

    let counts = revision_counts();
    let obj_uuid: Vec<String> = (0..N_OBJECTS).map(|i| uuid_v7(i as u64)).collect();
    let writer_uuid: Vec<String> = (0..N_WRITERS).map(|w| uuid_v7((w + 7) as u64)).collect();
    let mut writers: Vec<SegWriter> =
        writer_uuid.iter().map(|w| SegWriter::new(ledger_dir, w.clone())).collect();

    // Popularity weights for upstream references (rank-correlated with revision count).
    let mut ref_cum: Vec<f64> = Vec::with_capacity(N_OBJECTS);
    let mut acc = 0.0;
    for i in 0..N_OBJECTS {
        acc += ((i + 1) as f64).powf(-ZIPF_REF_EXP);
        ref_cum.push(acc);
    }

    // Schedules: object slots (counts[i] copies each) and entry kinds, shuffled.
    let mut obj_sched: Vec<u32> = Vec::with_capacity(N_TXF);
    for (i, &c) in counts.iter().enumerate() {
        for _ in 0..c {
            obj_sched.push(i as u32);
        }
    }
    rng.shuffle(&mut obj_sched);
    const K_TXF: u8 = 0;
    const K_NAV: u8 = 1;
    const K_RAT: u8 = 2;
    const K_WAI: u8 = 3;
    const K_CHK: u8 = 4;
    let mut kind_sched: Vec<u8> = Vec::with_capacity(TOTAL_ENTRIES);
    kind_sched.extend(std::iter::repeat(K_TXF).take(N_TXF));
    kind_sched.extend(std::iter::repeat(K_NAV).take(N_NAV));
    kind_sched.extend(std::iter::repeat(K_RAT).take(N_RATIFY));
    kind_sched.extend(std::iter::repeat(K_WAI).take(N_WAIVE));
    kind_sched.extend(std::iter::repeat(K_CHK).take(N_CHECK));
    rng.shuffle(&mut kind_sched);

    let mut objs: Vec<ObjState> =
        (0..N_OBJECTS).map(|_| ObjState { revs: Vec::new(), heads: Vec::new() }).collect();
    // Reservoir of (txf entry id, input idx, upstream obj, pinned rev) for resolutions.
    let mut reservoir: Vec<(String, u32, u32, String)> = Vec::new();
    const RESERVOIR_CAP: usize = 20_000;

    let mut st = GenStats {
        gen_ms: 0, entries: 0, txf: 0, root_txf: 0, edges_total: 0, edges_direct: 0,
        nav: 0, ratifications: 0, waivers: 0, check_results: 0, segments: 0,
        ledger_bytes: 0, rev_p50: 0, rev_p95: 0, rev_max: 0, multi_head_objects: 0,
    };
    let mut clock_ms: u64 = 0;
    let mut obj_idx = 0usize;

    for kind in kind_sched {
        clock_ms += 3 + rng.below(8);
        let time = rfc3339(clock_ms);
        let w = rng.below(N_WRITERS as u64) as usize;
        let entry_id = uuid_v7(clock_ms);

        let line = match kind {
            K_TXF => {
                let o = obj_sched[obj_idx] as usize;
                obj_idx += 1;
                emit_txf(rng, &mut objs, o, &obj_uuid, &ref_cum, &entry_id, &time,
                         &writer_uuid[w], &mut reservoir, RESERVOIR_CAP, &mut st)
            }
            K_RAT | K_WAI if !reservoir.is_empty() => {
                let (txf, input, u, pinned) = reservoir[rng.below(reservoir.len() as u64) as usize].clone();
                let uo = &objs[u as usize];
                let against = uo.revs[uo.heads[rng.below(uo.heads.len() as u64) as usize] as usize].clone();
                let kname = if kind == K_RAT { "ratification" } else { "waiver" };
                if kind == K_RAT { st.ratifications += 1 } else { st.waivers += 1 }
                let idem = format!("sha256:{}", sha256_hex(&[kname.as_bytes(), b"\n",
                    txf.as_bytes(), b"\n", input.to_string().as_bytes(), b"\n",
                    against.as_bytes(), b"\nauthor-1"]));
                let mut body = json!({
                    "edge": {"txf": txf, "input": input},
                    "upstream_object": obj_uuid[u as usize],
                    "pinned": pinned,
                    "resolved_against": against,
                    "actor": {"type": "human", "id": "author-1"}
                });
                if kind == K_WAI {
                    body["reason"] = json!("intentional divergence (synthetic)");
                }
                envelope(&entry_id, kname, &time, &writer_uuid[w], &idem, body)
            }
            K_CHK if !reservoir.is_empty() => {
                let (txf, input, u, pinned) = reservoir[rng.below(reservoir.len() as u64) as usize].clone();
                let uo = &objs[u as usize];
                let against = uo.revs[uo.heads[rng.below(uo.heads.len() as u64) as usize] as usize].clone();
                st.check_results += 1;
                let idem = format!("sha256:{}", sha256_hex(&[b"chk\n", txf.as_bytes(), b"\n",
                    input.to_string().as_bytes(), b"\n", pinned.as_bytes(), b"\n", against.as_bytes()]));
                envelope(&entry_id, "check-result", &time, &writer_uuid[w], &idem, json!({
                    "edge": {"txf": txf, "input": input},
                    "pinned": pinned,
                    "checked_against": against,
                    "verdict": "no-contradiction",
                    "model": "claude-fable-5",
                    "prompt_version": "check-v1",
                    "evidence": [],
                    "confidence": 0.8
                }))
            }
            _ => {
                // navigation (also the fallback when the reservoir is still empty)
                st.nav += 1;
                let from = hex(&rng.bytes16());
                let to = hex(&rng.bytes16());
                let coarse = &time[..19];
                let idem = format!("sha256:{}", sha256_hex(&[b"nav\n", from.as_bytes(), b"\n",
                    to.as_bytes(), b"\n", coarse.as_bytes()]));
                envelope(&entry_id, "navigation", &time, &writer_uuid[w], &idem, json!({
                    "git": {"op": "checkout", "from": from, "to": to, "ref": "main"}
                }))
            }
        };
        writers[w].append(&line);
        st.entries += 1;
    }

    for w in &mut writers {
        w.out.flush().unwrap();
        st.segments += w.files;
        st.ledger_bytes += w.total_bytes;
    }

    let mut sorted = counts.clone();
    sorted.sort_unstable();
    st.rev_p50 = sorted[N_OBJECTS / 2];
    st.rev_p95 = sorted[(N_OBJECTS as f64 * 0.95) as usize];
    st.rev_max = *sorted.last().unwrap();
    st.multi_head_objects = objs.iter().filter(|o| o.heads.len() > 1).count();
    st.gen_ms = t0.elapsed().as_millis();
    st
}

#[allow(clippy::too_many_arguments)]
fn emit_txf(rng: &mut Rng, objs: &mut [ObjState], o: usize, obj_uuid: &[String],
            ref_cum: &[f64], entry_id: &str, time: &str, writer: &str,
            reservoir: &mut Vec<(String, u32, u32, String)>, reservoir_cap: usize,
            st: &mut GenStats) -> String {
    st.txf += 1;
    let is_root = objs[o].revs.is_empty();
    let parents_idx: Vec<u32> = if is_root {
        st.root_txf += 1;
        Vec::new()
    } else {
        let ob = &objs[o];
        if ob.heads.len() >= 2 && rng.chance(P_MERGE) {
            let a = rng.below(ob.heads.len() as u64) as usize;
            let mut b = rng.below(ob.heads.len() as u64) as usize;
            while b == a { b = rng.below(ob.heads.len() as u64) as usize }
            vec![ob.heads[a], ob.heads[b]]
        } else if ob.revs.len() >= 3 && rng.chance(P_BRANCH) {
            vec![rng.below(ob.revs.len() as u64) as u32]
        } else {
            vec![ob.heads[rng.below(ob.heads.len() as u64) as usize]]
        }
    };
    let parent_ids: Vec<String> =
        parents_idx.iter().map(|&i| objs[o].revs[i as usize].clone()).collect();
    let chash = content_hash(&rng.bytes16());
    let rev = revision_id(&chash, &parent_ids);
    {
        let ob = &mut objs[o];
        ob.heads.retain(|h| !parents_idx.contains(h));
        let new_idx = ob.revs.len() as u32;
        ob.revs.push(rev.clone());
        ob.heads.push(new_idx);
    }

    let mut inputs = Vec::new();
    if !is_root {
        inputs.push(json!({"object": obj_uuid[o], "revision": parent_ids[0], "role": "direct"}));
        st.edges_total += 1;
        st.edges_direct += 1;
        let k = sample_k(rng);
        for _ in 1..k {
            for _try in 0..20 {
                let t = rng.f64() * ref_cum[N_OBJECTS - 1];
                let u = ref_cum.partition_point(|&c| c < t).min(N_OBJECTS - 1);
                if u == o || objs[u].revs.is_empty() {
                    continue;
                }
                let uo = &objs[u];
                let pin = uo.revs[uo.heads[rng.below(uo.heads.len() as u64) as usize] as usize].clone();
                let direct = !rng.chance(P_CONTEXTUAL);
                let idx = inputs.len() as u32;
                inputs.push(json!({"object": obj_uuid[u], "revision": pin,
                                   "role": if direct { "direct" } else { "contextual" }}));
                st.edges_total += 1;
                if direct {
                    st.edges_direct += 1;
                }
                if rng.chance(0.05) {
                    let item = (entry_id.to_string(), idx, u as u32, pin);
                    if reservoir.len() < reservoir_cap {
                        reservoir.push(item);
                    } else {
                        let slot = rng.below(reservoir_cap as u64) as usize;
                        reservoir[slot] = item;
                    }
                }
                break;
            }
        }
    }

    let mut sorted_parents = parent_ids.clone();
    sorted_parents.sort_unstable();
    let idem = format!("sha256:{}",
        sha256_hex(&[b"txf\n", obj_uuid[o].as_bytes(), b"\n", rev.as_bytes()]));
    let agent = if is_root || rng.chance(0.3) {
        json!({"type": "human"})
    } else {
        json!({"type": "model", "id": "claude-fable-5"})
    };
    envelope(entry_id, "transformation", time, writer, &idem, json!({
        "inputs": inputs,
        "outputs": [{"object": obj_uuid[o], "revision": rev,
                     "content_hash": chash, "parents": sorted_parents}],
        "agent": agent,
        "intent": {"kind": "genie", "summary": "synthetic transformation"},
        "confidence": "exact"
    }))
}

fn envelope(id: &str, kind: &str, time: &str, writer: &str, idem: &str,
            body: serde_json::Value) -> String {
    serde_json::to_string(&json!({
        "format": 0, "id": id, "kind": kind, "time": time,
        "writer": writer, "idem": idem, "body": body
    }))
    .unwrap()
}
