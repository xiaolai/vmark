//! Forward-operator accept primitives (Phase 3.0, service tier). This file is
//! the review-verified **accept idem** (design `design-runtime.md` v4.1 / spec
//! §13.3 — G-B rounds 3–6 confirmed it CORRECT): a deterministic, **injective**
//! identity over the complete canonical commit payload, so a lost-response retry
//! collapses to one logical entry while two genuinely distinct candidates never
//! share an idem.
//!
//! Injectivity comes from **length-prefixing** every field (`field`) and a
//! presence byte on every optional (`opt`), so no free-text value (`agent.id`,
//! `intent.summary`) can forge a field boundary and `None` is never aliased with
//! `Some("")`.

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::types::{AgentType, Confidence, InputRole, Transformation};

fn field(buf: &mut Vec<u8>, s: &[u8]) {
    buf.extend_from_slice(&(s.len() as u32).to_be_bytes());
    buf.extend_from_slice(s);
}

/// Optional field: a presence byte, then the length-prefixed value if present.
/// `None` (byte 0) is distinct from `Some("")` (byte 1 + a zero-length field).
fn opt(buf: &mut Vec<u8>, s: Option<&str>) {
    match s {
        None => buf.push(0),
        Some(v) => {
            buf.push(1);
            field(buf, v.as_bytes());
        }
    }
}

fn role_str(r: InputRole) -> &'static str {
    match r {
        InputRole::Direct => "direct",
        InputRole::Contextual => "contextual",
    }
}

fn agent_str(a: AgentType) -> &'static str {
    match a {
        AgentType::Human => "human",
        AgentType::Model => "model",
        AgentType::External => "external",
        AgentType::Git => "git",
    }
}

fn confidence_str(c: Confidence) -> &'static str {
    match c {
        Confidence::Exact => "exact",
        Confidence::Inferred => "inferred",
        Confidence::Unknown => "unknown",
    }
}

/// A UUID carrying the first 16 bytes of a digest, stamped with the RFC-4122
/// version-8 (custom) and variant-10 bits. Deterministic in the digest — no
/// `v8` crate feature needed.
fn uuid_from_digest(digest: [u8; 32]) -> Uuid {
    let mut b = [0u8; 16];
    b.copy_from_slice(&digest[..16]);
    b[6] = (b[6] & 0x0f) | 0x80; // version 8
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    Uuid::from_bytes(b)
}

/// The deterministic accept idem for a single-output operator transaction
/// (design v4.1). Errs if the transformation is not single-output — Increment-1
/// rejects multi-output operators (so edge identity `(txf,input)` stays unique).
///
/// `group` folds a multi-object group's identity into each member's idem
/// (design-accept-consistency #1). It is the **terminal, optional** field:
/// a single accept passes `None` and appends nothing, so its idem is
/// byte-identical to the pre-group v2 preimage (the reviewed single-accept
/// protocol is untouched); a group member passes `Some(group_id)` and appends
/// its length-prefixed id. Injective because it is the final field and a group
/// id is a fixed-length, non-empty hash — so a member idem can never alias the
/// standalone idem of the same candidate, and a coincidental prior commit is
/// never misread as group membership.
pub fn operator_accept_idem(
    operator: &str,
    format: u32,
    txf: &Transformation,
    group: Option<&str>,
) -> Result<Uuid, String> {
    if txf.outputs.len() != 1 {
        return Err(format!(
            "operator accept requires exactly one output (Increment-1), got {}",
            txf.outputs.len()
        ));
    }
    let out = &txf.outputs[0];
    let mut buf = Vec::with_capacity(256);

    field(&mut buf, b"vmark-operator-accept-v2"); // versioned domain tag (v2: +input.kind)
    field(&mut buf, format.to_string().as_bytes());
    field(&mut buf, operator.as_bytes());

    field(&mut buf, out.object.0.to_string().as_bytes());
    field(&mut buf, out.content_hash.as_str().as_bytes());
    field(&mut buf, out.revision.as_str().as_bytes());

    // list(sorted(parents)) — lexicographic, matching RevisionId::compute.
    let mut parents: Vec<&str> = out.parents.iter().map(|p| p.as_str()).collect();
    parents.sort_unstable();
    buf.extend_from_slice(&(parents.len() as u32).to_be_bytes());
    for p in parents {
        field(&mut buf, p.as_bytes());
    }

    // list(inputs in DECLARED order) — object, revision, role, KIND each. The
    // edge kind is part of the identity (G-B group-commit review #6): a
    // Dependency and a Conformance input over the same object/revision are
    // distinct commits and must not collide.
    buf.extend_from_slice(&(txf.inputs.len() as u32).to_be_bytes());
    for i in &txf.inputs {
        field(&mut buf, i.object.0.to_string().as_bytes());
        field(&mut buf, i.revision.as_str().as_bytes());
        field(&mut buf, role_str(i.role).as_bytes());
        field(&mut buf, i.kind.as_str().as_bytes());
    }

    field(&mut buf, agent_str(txf.agent.kind).as_bytes());
    opt(&mut buf, txf.agent.id.as_deref());
    field(&mut buf, txf.intent.kind.as_bytes());
    field(&mut buf, txf.intent.summary.as_bytes());
    opt(
        &mut buf,
        txf.intent.prompt_hash.as_ref().map(|h| h.as_str()),
    );
    field(&mut buf, confidence_str(txf.confidence).as_bytes());

    // Terminal optional field: the group identity (design-accept-consistency #1).
    // Appended only when present, so a single accept's idem is unchanged.
    if let Some(g) = group {
        field(&mut buf, g.as_bytes());
    }

    Ok(uuid_from_digest(Sha256::digest(&buf).into()))
}

#[cfg(test)]
#[path = "operator_accept.test.rs"]
mod tests;
