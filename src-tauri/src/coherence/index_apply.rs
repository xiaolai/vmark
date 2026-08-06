//! How one ledger entry becomes index rows.
//!
//! Split from `index.rs` for the file-size gate, on a real seam: this is the
//! entry→SQL mapping and nothing else. It takes an already-open connection and
//! neither commits nor rolls back — `apply_entry` wraps it in its own
//! transaction for a standalone apply, and `rebuild_from` runs the whole replay
//! inside ONE transaction. That split is what makes a rebuild ~47x faster: a
//! per-entry commit is a per-entry durable write.
//!
//! @coordinates-with index.rs — the module this was split from
//! @module coherence/index_apply

use super::types::{Envelope, InputRole, TypedBody};

/// Apply one entry to an ALREADY-OPEN transaction. No commit, no rollback —
/// the caller owns the boundary, which is what lets a rebuild batch.
pub(super) fn apply_entry_to(tx: &rusqlite::Connection, env: &Envelope) -> Result<(), String> {
    let typed = env
        .typed()
        .map_err(|e| format!("index apply on malformed entry: {e}"))?;
    // Keyed by IDEM, not entry id (audit A4): a crash-recovery replay
    // carries the same idem with a fresh id and must not re-apply.
    // Store the entry id alongside the idem (design v4.2): the FIRST entry
    // for an idem wins (INSERT OR IGNORE), so a later replay does not
    // overwrite it — `entry_id_by_idem` then returns the original receipt.
    let inserted = tx
        .execute(
            "INSERT OR IGNORE INTO applied (idem, entry_id) VALUES (?1, ?2)",
            [env.idem.to_string(), env.id.to_string()],
        )
        .map_err(|e| e.to_string())?;
    if inserted == 0 {
        return Ok(()); // replay
    }
    match typed {
        TypedBody::Transformation(t) => {
            for o in &t.outputs {
                tx.execute(
                    "INSERT OR IGNORE INTO revisions (object, revision, parents, content_hash) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        o.object.0.to_string(),
                        o.revision.as_str(),
                        serde_json::to_string(&o.parents).map_err(|e| e.to_string())?,
                        o.content_hash.as_str()
                    ],
                )
                .map_err(|e| e.to_string())?;
                // A new revision revives an absent object (file restored).
                tx.execute(
                    "DELETE FROM absent WHERE object = ?1",
                    [o.object.0.to_string()],
                )
                .map_err(|e| e.to_string())?;
                for (i, input) in t.inputs.iter().enumerate() {
                    tx.execute(
                        "INSERT OR IGNORE INTO edges (txf, input_idx, upstream, pinned, downstream, downstream_rev, role, confidence, edge_kind)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        rusqlite::params![
                            env.id.to_string(),
                            i as i64,
                            input.object.0.to_string(),
                            input.revision.as_str(),
                            o.object.0.to_string(),
                            o.revision.as_str(),
                            match input.role {
                                InputRole::Direct => "direct",
                                InputRole::Contextual => "contextual",
                            },
                            match t.confidence {
                                super::types::Confidence::Exact => "exact",
                                super::types::Confidence::Inferred => "inferred",
                                super::types::Confidence::Unknown => "unknown",
                            },
                            // Phase 4: persist the input's origin-edge kind
                            // (conformance from Extract-Canon; else dependency).
                            input.kind.as_str(),
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        TypedBody::Ratification(r) | TypedBody::Waiver(r) => {
            let kind = if env.kind == "ratification" {
                "ratification"
            } else {
                "waiver"
            };
            tx.execute(
                "INSERT OR IGNORE INTO resolutions (entry_id, txf, input_idx, kind, resolved_against, time, expires)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    env.id.to_string(),
                    r.edge.txf.to_string(),
                    r.edge.input as i64,
                    kind,
                    r.resolved_against.as_str(),
                    env.time,
                    r.expires
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        TypedBody::ObjectRegistered(r) => {
            tx.execute(
                "INSERT OR IGNORE INTO registry (entry_id, object, path, schema, time) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    env.id.to_string(),
                    r.object.0.to_string(),
                    r.path,
                    r.schema,
                    env.time
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        TypedBody::Preserved { ref kind, ref body } if kind == "check-result" => {
            // WI-2b.3: validated at parse (envelope.rs); the D5.6
            // context fields are nullable — results without them are
            // pre-revision-1 history and never satisfy liveness.
            tx.execute(
                "INSERT OR IGNORE INTO check_results
                 (entry_id, txf, input_idx, pinned, checked_against, verdict, time, context, claims_fingerprint)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    env.id.to_string(),
                    body["edge"]["txf"].as_str().unwrap_or_default(),
                    body["edge"]["input"].as_i64().unwrap_or_default(),
                    body["pinned"].as_str().unwrap_or_default(),
                    body["checked_against"].as_str().unwrap_or_default(),
                    body["verdict"].as_str().unwrap_or_default(),
                    env.time,
                    body.get("context").and_then(|v| v.as_str()),
                    body.get("claims_fingerprint").and_then(|v| v.as_str()),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => {} // navigation, diagnostics, other preserved and unknown kinds
    }
    Ok(())
}
