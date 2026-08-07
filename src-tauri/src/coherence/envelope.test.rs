// Envelope typing — the TRUST BOUNDARY for ledger entries.
//
// Every entry here can arrive from another machine through a git merge, so it
// never passed through our command-layer validation. The rule these tests
// enforce: a malformed entry is REJECTED (and therefore quarantined), never
// coerced into something plausible. Coercion is the dangerous direction — a
// coerced lifecycle or anchor entry silently SUPPRESSES a staleness flag, which
// is the worst failure this system has.

use super::*;
use crate::coherence::types::WriterId;
use serde_json::json;

fn w() -> WriterId {
    WriterId(uuid::Uuid::from_u128(1))
}

fn env(kind: &str, body: serde_json::Value) -> Envelope {
    Envelope::create(kind, w(), body)
}

const TXF: &str = "019f75b7-74f9-79f3-a00f-c426a7f6a462";
const OBJ: &str = "019f758b-af1f-7821-bd64-8c5e584cf25a";
const HASH: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ---- edge coordinates must be a real (Uuid, u32) ----

#[test]
fn a_non_uuid_txf_is_rejected_on_every_edge_scoped_kind() {
    // A non-UUID txf previously reached SQLite and later made the sweep's
    // checked_cursor() fail wholesale; it also splits one physical edge into
    // several logbook rows.
    for kind in ["flag-judgment", "edge-anchor", "check-result"] {
        let e = env(
            kind,
            json!({ "edge": { "txf": "not-a-uuid", "input": 0 },
                    "judgment": "noise", "headings": [], "verdict": "unknown",
                    "pinned": "rev1:".to_string() + &"a".repeat(64),
                    "checked_against": "rev1:".to_string() + &"b".repeat(64) }),
        );
        assert!(e.typed().is_err(), "{kind} accepted a non-uuid txf");
    }
}

#[test]
fn a_missing_or_oversized_input_is_rejected() {
    // An absent input defaulted to 0 on apply, letting a forged result attach
    // itself to a real input-0 edge.
    let missing = env(
        "flag-judgment",
        json!({ "edge": { "txf": TXF }, "judgment": "noise" }),
    );
    assert!(missing.typed().is_err(), "missing input must be rejected");

    let too_big = env(
        "flag-judgment",
        json!({ "edge": { "txf": TXF, "input": 5_000_000_000u64 }, "judgment": "noise" }),
    );
    assert!(
        too_big.typed().is_err(),
        "input beyond u32 must be rejected"
    );
}

// ---- edge-anchor ----

#[test]
fn an_edge_anchor_without_an_array_of_headings_is_rejected() {
    // AnchorSet consumes the raw body: a missing or non-array `headings` would
    // be read as an EMPTY path and silently CLEAR a prior anchor.
    let missing = env("edge-anchor", json!({ "edge": { "txf": TXF, "input": 0 } }));
    assert!(
        missing.typed().is_err(),
        "missing headings must be rejected"
    );

    let not_array = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 0 }, "headings": "5. Resolution" }),
    );
    assert!(not_array.typed().is_err());

    let not_strings = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 0 }, "headings": [1, 2] }),
    );
    assert!(not_strings.typed().is_err());
}

#[test]
fn a_non_empty_anchor_without_a_valid_hash_is_rejected() {
    // Without a valid baseline the anchor cannot be compared; accepting it would
    // leave an OLDER anchor live and keep suppressing.
    let e = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 0 },
                "headings": ["5. Resolution"], "anchored_hash": "nonsense" }),
    );
    assert!(e.typed().is_err());
}

#[test]
fn an_empty_heading_path_is_the_valid_clear_form() {
    // Clearing carries no hash by design.
    let e = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 0 }, "headings": [] }),
    );
    assert!(
        e.typed().is_ok(),
        "the explicit clear form must be accepted"
    );
}

#[test]
fn an_oversized_anchor_path_is_rejected() {
    let deep: Vec<String> = (0..super::super::anchors::MAX_PATH_SEGMENTS + 1)
        .map(|i| format!("h{i}"))
        .collect();
    let e = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 0 },
                "headings": deep, "anchored_hash": HASH }),
    );
    assert!(e.typed().is_err());
}

// ---- object-lifecycle ----

#[test]
fn an_unknown_lifecycle_state_is_rejected_never_coerced() {
    // Coercing toward `frozen` would silently suppress flags — the most
    // damaging possible failure for this feature.
    let e = env(
        "object-lifecycle",
        json!({ "object": OBJ, "state": "archived" }),
    );
    assert!(e.typed().is_err());
}

#[test]
fn an_oversized_lifecycle_reason_is_rejected_on_replay() {
    // The setter bounds this, but a git-merged entry never went through it.
    let e = env(
        "object-lifecycle",
        json!({ "object": OBJ, "state": "frozen",
                "reason": "x".repeat(super::super::lifecycle::MAX_REASON_BYTES + 1) }),
    );
    assert!(e.typed().is_err());
}

// ---- check-result ----

#[test]
fn a_confidence_outside_zero_to_one_is_rejected() {
    // Confidence drives the tau decision and the M3 reading; 2.0 is not a
    // probability and must not earn a determinate verdict.
    let e = env(
        "check-result",
        json!({ "edge": { "txf": TXF, "input": 0 },
                "pinned": "rev1:".to_string() + &"a".repeat(64),
                "checked_against": "rev1:".to_string() + &"b".repeat(64),
                "verdict": "no-contradiction", "confidence": 2.0 }),
    );
    assert!(e.typed().is_err());
}

#[test]
fn a_well_formed_entry_of_each_new_kind_is_accepted() {
    // The rejections above must not be over-broad.
    let judgment = env(
        "flag-judgment",
        json!({ "edge": { "txf": TXF, "input": 0 }, "judgment": "relevant", "note": "ok" }),
    );
    assert!(judgment.typed().is_ok());

    let anchor = env(
        "edge-anchor",
        json!({ "edge": { "txf": TXF, "input": 2 },
                "headings": ["5. Resolution", "5.2 Waivers"], "anchored_hash": HASH }),
    );
    assert!(anchor.typed().is_ok());

    let lifecycle = env(
        "object-lifecycle",
        json!({ "object": OBJ, "state": "frozen", "reason": "finished plan" }),
    );
    assert!(lifecycle.typed().is_ok());
}
