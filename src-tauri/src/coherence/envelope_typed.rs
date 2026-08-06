//! `Envelope::typed()` — parsing an envelope body into its validated typed form.
//!
//! Split out of `envelope.rs` for size. This is the single dispatch that turns
//! UNTRUSTED ledger JSON into a `TypedBody`, applying every per-kind field check;
//! `envelope.rs` keeps the record itself and its construction.
//!
//! An envelope arrives from a file other tools can append to, so this function
//! is a trust boundary — which is exactly why it is worth reading on its own.
//!
//! @coordinates-with envelope.rs — the Envelope record and TypedBody enum
//! @coordinates-with envelope_validate.rs — the field-level checks it calls
//! @module coherence/envelope_typed

use super::envelope::{Envelope, TypedBody};
use super::envelope_validate::{bounded_str, edge_coords};
use super::types::{Resolution, Transformation, FORMAT_VERSION};
use uuid::Uuid;

impl Envelope {
    /// Dispatch the raw body by kind. `Err` means a malformed *known*
    /// kind (quarantine, spec §5.6); unknown kinds are `Ok(Unknown)`.
    pub fn typed(&self) -> Result<TypedBody, String> {
        if self.format > FORMAT_VERSION {
            return Err(format!("format {} is newer than this reader", self.format));
        }
        fn parse<T: serde::de::DeserializeOwned>(v: &serde_json::Value) -> Result<T, String> {
            serde_json::from_value(v.clone()).map_err(|e| e.to_string())
        }
        let b = &self.body;
        Ok(match self.kind.as_str() {
            "transformation" => {
                let t: Transformation = parse(b)?;
                if t.outputs.is_empty() {
                    return Err("transformation with no outputs".into());
                }
                TypedBody::Transformation(t)
            }
            "navigation" => TypedBody::Navigation(parse(b)?),
            "ratification" | "waiver" => {
                let r: Resolution = parse(b)?;
                // Spec §5.4.3 rev 2 (D2.4): a non-human resolution MUST
                // reference the grant that authorized it.
                let is_human = b
                    .get("actor")
                    .and_then(|a| a.get("type"))
                    .and_then(|v| v.as_str())
                    == Some("human");
                if !is_human && b.get("delegation").and_then(|v| v.as_str()).is_none() {
                    return Err("non-human resolution without a delegation reference".into());
                }
                if self.kind == "ratification" {
                    TypedBody::Ratification(r)
                } else {
                    TypedBody::Waiver(r)
                }
            }
            // The owner's M2 relevance judgment for a flagged edge (logbook).
            // Validated at the boundary so a mis-typed judgment can never reach
            // the metric: an unrecognised value would silently skew M2.
            "flag-judgment" => {
                // Coordinates must be a REAL UUID and a real u32, not merely
                // "some string" and "some number". Alternate UUID spellings
                // would split one physical edge into several logbook rows, and a
                // non-UUID would let a crafted entry mint a phantom row that
                // corrupts the M2 denominator.
                edge_coords(b, "flag-judgment")?;
                match b.get("judgment").and_then(|v| v.as_str()) {
                    Some(j) if super::logbook::JUDGMENTS.contains(&j) => {}
                    _ => return Err("flag-judgment with an unknown judgment value".into()),
                }
                bounded_str(b, "note", super::logbook::MAX_NOTE_BYTES, "flag-judgment")?;
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            // Section anchor for one edge. Validated because `AnchorSet` consumes
            // the raw body: an absent or non-array `headings` would otherwise be
            // read as an empty path and SILENTLY CLEAR a prior anchor, and a
            // missing hash on a non-empty path would leave an older anchor live.
            "edge-anchor" => {
                edge_coords(b, "edge-anchor")?;
                let headings = b
                    .get("headings")
                    .and_then(|v| v.as_array())
                    .ok_or("edge-anchor headings must be an array")?;
                if headings.len() > super::anchors::MAX_PATH_SEGMENTS {
                    return Err("edge-anchor path has too many segments".into());
                }
                for h in headings {
                    let seg = h.as_str().ok_or("edge-anchor heading is not a string")?;
                    if seg.is_empty() || seg.len() > super::anchors::MAX_SEGMENT_BYTES {
                        return Err("edge-anchor heading is empty or too long".into());
                    }
                }
                // An empty path is the explicit CLEAR form and carries no hash;
                // any other path must carry a valid one.
                if !headings.is_empty() {
                    let ok = b
                        .get("anchored_hash")
                        .and_then(|v| v.as_str())
                        .is_some_and(|h| super::types::ContentHash::parse(h).is_ok());
                    if !ok {
                        return Err("edge-anchor without a valid anchored_hash".into());
                    }
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            // Document lifecycle transition. Validated at the boundary: an
            // unrecognised state must never be coerced, because coercing toward
            // `frozen` would SILENTLY SUPPRESS staleness flags — the most
            // damaging failure this feature can have.
            "object-lifecycle" => {
                if b.get("object")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .is_none()
                {
                    return Err("object-lifecycle without a valid object id".into());
                }
                match b.get("state").and_then(|v| v.as_str()) {
                    Some(st) if super::lifecycle::STATES.contains(&st) => {}
                    _ => return Err("object-lifecycle with an unknown state".into()),
                }
                bounded_str(
                    b,
                    "reason",
                    super::lifecycle::MAX_REASON_BYTES,
                    "object-lifecycle",
                )?;
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "object-registered" => TypedBody::ObjectRegistered(parse(b)?),
            // Spec §5.4.7 rev 2: delegation is a known, validated kind.
            "delegation" => {
                for key in ["delegation", "expires"] {
                    if b.get(key).and_then(|v| v.as_str()).is_none() {
                        return Err(format!("delegation missing {key}"));
                    }
                }
                if b.get("delegate")
                    .and_then(|d| d.get("id"))
                    .and_then(|v| v.as_str())
                    .is_none()
                {
                    return Err("delegation missing delegate.id".into());
                }
                if !b.get("scope").map(|s| s.is_array()).unwrap_or(false) {
                    return Err("delegation scope must be an array".into());
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "diagnostic" => TypedBody::Diagnostic(parse(b)?),
            // Known Phase-2b kinds: preserved, but schema-VALIDATED now so
            // malformed records quarantine instead of festering (§5.6).
            "check-result" => {
                // A crafted `txf` that is not a UUID was previously accepted into
                // SQLite and later made `checked_cursor()` fail the whole sweep;
                // an absent `input` defaulted to 0 on apply, letting a forged
                // result attach itself to a real input-0 edge.
                edge_coords(b, "check-result")?;
                for key in ["pinned", "checked_against"] {
                    let ok = b
                        .get(key)
                        .and_then(|v| v.as_str())
                        .is_some_and(|v| super::types::RevisionId::parse(v).is_ok());
                    if !ok {
                        return Err(format!("check-result {key} is not a revision id"));
                    }
                }
                let verdict = b
                    .get("verdict")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !["no-contradiction", "contradiction", "unknown"].contains(&verdict) {
                    return Err(format!("check-result verdict invalid: {verdict:?}"));
                }
                // Confidence drives the tau decision and the M3 reading; a value
                // outside [0,1] (or non-finite) is not a probability and must not
                // reach either.
                if let Some(c) = b.get("confidence") {
                    let ok = c
                        .as_f64()
                        .is_some_and(|c| c.is_finite() && (0.0..=1.0).contains(&c));
                    if !ok {
                        return Err("check-result confidence is not in [0,1]".into());
                    }
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "claim" => {
                if b.get("claim").and_then(|v| v.as_str()).is_none()
                    || b.get("statement").and_then(|v| v.as_str()).is_none()
                {
                    return Err("claim requires string claim + statement".into());
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            // Durable group-commit lifecycle records (design-accept-consistency
            // #5/#6/#7). `group-prepare` marks a validated group whose commit
            // started (carries its member manifest + a base-head/resolution
            // snapshot for recovery revalidation); `group-abort` marks an attempt
            // abandoned because its context changed. Both are keyed by `group_id`.
            "group-prepare" => {
                // Full structural validation (re-review #7): a body that would
                // later panic/parse-fail in recovery must QUARANTINE at read, never
                // reach the lifecycle lookup and poison it forever.
                for k in ["group_id", "attempt_id"] {
                    if b.get(k).and_then(|v| v.as_str()).is_none_or(str::is_empty) {
                        return Err(format!("group-prepare missing/empty {k}"));
                    }
                }
                if !b.get("members").map(|m| m.is_array()).unwrap_or(false) {
                    return Err("group-prepare members must be an array".into());
                }
                let snap = b.get("snapshot").filter(|s| s.is_object());
                let snap = snap.ok_or("group-prepare missing snapshot")?;
                if !snap.get("heads").map(|h| h.is_array()).unwrap_or(false) {
                    return Err("group-prepare snapshot.heads must be an array".into());
                }
                if snap
                    .get("resolution_digest")
                    .and_then(|v| v.as_str())
                    .is_none()
                {
                    return Err("group-prepare snapshot.resolution_digest must be a string".into());
                }
                // Every affected_edge must be a [uuid-string, number] pair — a
                // non-UUID txf would abort recovery before an abort could be written.
                let edges = snap
                    .get("affected_edges")
                    .and_then(|v| v.as_array())
                    .ok_or("group-prepare snapshot.affected_edges must be an array")?;
                for edge in edges {
                    let pair = edge
                        .as_array()
                        .ok_or("affected_edge must be a [txf, input] pair")?;
                    let txf = pair
                        .first()
                        .and_then(|v| v.as_str())
                        .ok_or("affected_edge txf must be a string")?;
                    if uuid::Uuid::parse_str(txf).is_err() {
                        return Err("affected_edge txf is not a valid uuid".into());
                    }
                    if pair.get(1).and_then(|v| v.as_u64()).is_none() {
                        return Err("affected_edge input must be a number".into());
                    }
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            "group-abort" => {
                // #7: an abort MUST name its attempt, or find_latest silently
                // ignores it and the aborted attempt looks live.
                for k in ["group_id", "attempt_id"] {
                    if b.get(k).and_then(|v| v.as_str()).is_none_or(str::is_empty) {
                        return Err(format!("group-abort missing/empty {k}"));
                    }
                }
                TypedBody::Preserved {
                    kind: self.kind.clone(),
                    body: b.clone(),
                }
            }
            _ => TypedBody::Unknown {
                kind: self.kind.clone(),
                body: b.clone(),
            },
        })
    }
}
