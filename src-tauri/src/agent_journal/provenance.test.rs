// WI-AL1.2 — provenance accumulator and persisted payload against the shared golden fixture (byte-for-byte parity with TypeScript)
//! R19–R23 — the provenance accumulator and its persisted payload, against
//! `src/test/fixtures/agentJournal/provenance.json` (generated from a brute-force reference, not
//! from either accumulator). Every case is replayed through the Rust port:
//! the payload must equal the golden one byte for byte (same key order,
//! same numbers), every span mapping must match, the golden payload must
//! decode back to an accumulator that maps identically, and every invalid
//! payload must be refused. A missing fixture fails loudly. The writer
//! vectors (§8) are consumed by `provenance_writer_golden.test.rs` and
//! `provenance_review_golden.test.rs`; `KEYS` below fails on a key neither reads.

use super::test_golden_prov::*;
use crate::agent_journal::provenance::{
    BreakReason, Provenance, ProvenancePayload, Section, PROVENANCE_CAP,
};

/// Every top-level key of the fixture and the test file that consumes it. A
/// key no Rust test reads is parity nobody enforces, so a new one fails here.
const KEYS: [(&str, &str); 13] = [
    ("spec", "metadata"),
    ("generator", "metadata"),
    ("unit", "here"),
    ("maxCap", "here"),
    ("cases", "here"),
    ("invalid", "here"),
    ("writerCases", "provenance_writer_golden.test.rs"),
    ("textChecks", "provenance_writer_golden.test.rs"),
    ("workerPayloads", "provenance_writer_golden.test.rs"),
    ("mappedSpans", "provenance_review_golden.test.rs"),
    ("revertGate", "provenance_review_golden.test.rs"),
    ("epochs", "provenance_review_golden.test.rs"),
    ("barriers", "provenance_review_golden.test.rs"),
];

#[test]
fn the_fixture_has_every_key_and_none_is_empty() {
    let g = golden();
    let mut keys: Vec<&str> = g
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    let mut known: Vec<&str> = KEYS.iter().map(|(k, _)| *k).collect();
    keys.sort_unstable();
    known.sort_unstable();
    assert_eq!(
        keys, known,
        "a golden key without a Rust consumer, or a consumer without its key"
    );
    assert_eq!(g["unit"], "utf16CodeUnit");
    assert_eq!(g["maxCap"].as_u64(), Some(PROVENANCE_CAP));
    for key in [
        "cases",
        "invalid",
        "writerCases",
        "textChecks",
        "workerPayloads",
        "mappedSpans",
        "revertGate",
    ] {
        let mut names: Vec<&str> = entries(&g, key).iter().map(|e| s(e, "name")).collect();
        let n = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), n, "{key}: vector names are not unique");
    }
    entries(&g["epochs"], "sequences");
    entries(&g["epochs"], "restartBlocks");
    assert!(
        g["epochs"]["writerEpoch"]["noneArmed"].is_string(),
        "epochs.writerEpoch.noneArmed"
    );
    assert!(
        !g["barriers"].as_object().expect("barriers").is_empty(),
        "barriers is empty"
    );
}

#[test]
fn every_case_encodes_to_the_golden_payload() {
    for c in entries(&golden(), "cases") {
        let name = c["name"].as_str().unwrap();
        let p = replay(c);
        let payload = encode(c, &p);
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            c["payload"],
            "{name}"
        );
        check_spans(name, c, &p);
    }
}

/// Byte-for-byte against the file's own layout (`assert_bytes`).
#[test]
fn every_payload_serializes_byte_for_byte() {
    let text = golden_text();
    for c in entries(&golden(), "cases") {
        assert_bytes(&text, s(c, "name"), "payload", &encode(c, &replay(c)), 6);
    }
}

#[test]
fn every_golden_payload_decodes_maps_and_re_encodes_identically() {
    for c in entries(&golden(), "cases") {
        let name = c["name"].as_str().unwrap();
        let payload: ProvenancePayload = serde_json::from_value(c["payload"].clone())
            .unwrap_or_else(|e| panic!("{name}: golden payload refused: {e}"));
        let (pre, post) = (c["pre"].as_str().unwrap(), c["post"].as_str().unwrap());
        payload
            .check_texts(pre, post)
            .unwrap_or_else(|e| panic!("{name}: texts refused: {e}"));
        let p = payload.accumulator().expect("accumulator");
        check_spans(name, c, &p);
        assert_eq!(
            encode(c, &p),
            payload,
            "{name}: decode → encode is not the identity"
        );
    }
}

#[test]
fn every_invalid_payload_is_refused() {
    for v in entries(&golden(), "invalid") {
        let name = v["name"].as_str().unwrap();
        let r = serde_json::from_value::<ProvenancePayload>(v["payload"].clone());
        assert!(r.is_err(), "{name}: an invalid payload decoded");
    }
}

#[test]
fn hashes_and_lengths_bind_the_payload_to_its_texts() {
    let g = golden();
    let c = &g["cases"][0];
    let payload: ProvenancePayload = serde_json::from_value(c["payload"].clone()).unwrap();
    let (pre, post) = (c["pre"].as_str().unwrap(), c["post"].as_str().unwrap());
    assert!(payload.check_texts(pre, post).is_ok());
    assert!(payload.check_texts(post, pre).is_err(), "swapped texts");
    assert!(
        payload.check_texts(pre, "YXd").is_err(),
        "same length, other postimage"
    );
    // Encoding refuses texts whose lengths are not the accumulator's.
    let p = replay(c);
    assert!(ProvenancePayload::encode("d", "1", "b", "abcd", post, &p).is_err());
    assert!(
        ProvenancePayload::encode("", "1", "b", pre, post, &p).is_err(),
        "empty document id"
    );
    assert!(
        ProvenancePayload::encode("d", "01", "b", pre, post, &p).is_err(),
        "non-canonical epoch"
    );
    assert!(
        ProvenancePayload::encode("d", "1", "", pre, post, &p).is_err(),
        "empty basis"
    );
}

/// A certified map whose surviving characters are not the texts' is a lie
/// about the texts, not a map: refused even when hashes and lengths match.
#[test]
fn a_certified_map_must_agree_with_its_texts() {
    let mut p = Provenance::new(3, PROVENANCE_CAP).unwrap();
    p.compose(&[Section {
        from_a: 1,
        to_a: 2,
        from_b: 1,
        to_b: 2,
    }])
    .unwrap(); // replace "b"
    let ok = ProvenancePayload::encode("d", "1", "b", "abc", "aXc", &p).unwrap();
    assert!(ok.check_texts("abc", "aXc").is_ok());
    let lie = ProvenancePayload::encode("d", "1", "b", "abc", "Xbc", &p).unwrap();
    assert!(
        lie.check_texts("abc", "Xbc").is_err(),
        "'a' survives the map but not the text"
    );
}

#[test]
fn malformed_operations_are_refused() {
    let mut p = Provenance::new(3, PROVENANCE_CAP).unwrap();
    assert!(
        p.compose(&[Section {
            from_a: 2,
            to_a: 4,
            from_b: 2,
            to_b: 2
        }])
        .is_err(),
        "past the end"
    );
    assert!(
        p.compose(&[Section {
            from_a: 2,
            to_a: 1,
            from_b: 2,
            to_b: 2
        }])
        .is_err(),
        "inverted"
    );
    let two = [
        Section {
            from_a: 2,
            to_a: 3,
            from_b: 2,
            to_b: 2,
        },
        Section {
            from_a: 0,
            to_a: 1,
            from_b: 0,
            to_b: 0,
        },
    ];
    assert!(p.compose(&two).is_err(), "unsorted");
    assert!(p
        .break_range(0, 4, 0, BreakReason::UncertifiedRange, "wysiwyg")
        .is_err());
    assert!(
        p.break_range(0, 1, 0, BreakReason::UncertifiedRange, "")
            .is_err(),
        "a break needs an origin"
    );
    assert!(p.map_span(0, 4, false).is_err(), "gap outside the preimage");
    assert!(
        Provenance::new(0, 0).is_err() && Provenance::new(0, PROVENANCE_CAP + 1).is_err(),
        "cap bounds"
    );
}

/// Rapid repeated typing and deleting at one place stays a constant number
/// of entries (R19), and keeps its touch history.
#[test]
fn rapid_repeated_edits_stay_bounded_and_lossless() {
    let mut p = Provenance::new(4, PROVENANCE_CAP).unwrap();
    for _ in 0..10_000 {
        p.compose(&[Section {
            from_a: 2,
            to_a: 2,
            from_b: 2,
            to_b: 3,
        }])
        .unwrap();
        p.compose(&[Section {
            from_a: 2,
            to_a: 3,
            from_b: 2,
            to_b: 2,
        }])
        .unwrap();
    }
    assert!(p.entries() <= 8, "entries {}", p.entries());
    let m = p.map_span(1, 3, false).unwrap();
    assert!(
        m.hit && m.block.is_none(),
        "net-zero edits are still recorded"
    );
}

#[test]
fn the_cap_turns_into_a_whole_break() {
    let mut p = Provenance::new(40, 8).unwrap();
    for k in (0..10).rev() {
        p.compose(&[Section {
            from_a: 4 * k,
            to_a: 4 * k + 1,
            from_b: 4 * k,
            to_b: 4 * k,
        }])
        .unwrap();
    }
    let m = p.map_span(39, 40, false).unwrap();
    assert_eq!(
        serde_json::to_value(m.block).unwrap(),
        serde_json::json!({"reason": "capOverflow", "origin": "accumulator"})
    );
    assert!(p.entries() <= 8);
}

/// `L ≤ R` at every gap, checked at both ends of each run, and canonical runs.
#[test]
fn a_map_with_l_above_r_or_split_runs_is_refused() {
    let g = golden();
    let mut v = g["cases"][4]["payload"].clone(); // start-and-end: "ab" → "<ab>"
    assert!(serde_json::from_value::<ProvenancePayload>(v.clone()).is_ok());
    v["body"]["map"]["L0"] = serde_json::json!(2); // L(0) = 2 > R(0)
    assert!(serde_json::from_value::<ProvenancePayload>(v.clone()).is_err());
    let mut split = g["cases"][2]["payload"].clone(); // net-zero: identity over 11 characters
    split["body"]["map"]["runs"] = serde_json::json!([[5, 1, 1], [6, 1, 1]]);
    assert!(
        serde_json::from_value::<ProvenancePayload>(split).is_err(),
        "non-canonical runs"
    );
    let mut short = g["cases"][2]["payload"].clone();
    short["body"]["map"]["runs"] = serde_json::json!([[10, 1, 1]]);
    assert!(
        serde_json::from_value::<ProvenancePayload>(short).is_err(),
        "runs must cover lenA"
    );
}
