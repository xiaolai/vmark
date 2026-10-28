// WI-AL1.2 — well-formed text at the JSON boundary (INVALID_TEXT, never U+FFFD)
//! R12 — well-formed text at the Rust boundary, driven by
//! `golden/unicode.json`. Ill-formed text (a lone surrogate) is
//! `INVALID_TEXT` for controlled mutations, with nothing appended, queued
//! or reserved; an observational capture reports `journaled: "no"` with
//! reason `INVALID_TEXT` and journals nothing. Never U+FFFD.

use super::test_support::*;
use crate::agent_journal::ids::DocId;
use serde_json::{json, Value};

const SLOT: &str = "@@TEXT@@";

fn cases() -> Vec<(String, Vec<u16>, bool)> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/agentJournal/unicode.json");
    let g: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("golden unicode.json")).unwrap();
    let cases: Vec<_> = g["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["name"].as_str().unwrap().to_string(),
                serde_json::from_value(c["utf16"].clone()).unwrap(),
                c["wellFormed"].as_bool().unwrap(),
            )
        })
        .collect();
    assert!(
        cases.iter().any(|c| c.2) && cases.iter().any(|c| !c.2),
        "both kinds present"
    );
    cases
}

/// The payload a webview would send: `JSON.stringify` writes every unit
/// that is not printable ASCII as a `\uXXXX` escape.
fn payload(template: Value, units: &[u16]) -> Vec<u8> {
    let escaped: String = units.iter().map(|u| format!("\\u{u:04x}")).collect();
    template
        .to_string()
        .replacen(&format!("\"{SLOT}\""), &format!("\"{escaped}\""), 1)
        .into_bytes()
}

fn prepare_template(doc: DocId, parent: Option<crate::agent_journal::ids::RevisionId>) -> Value {
    json!({ "doc": doc, "parent": parent, "preimage": SLOT, "actor": agent(), "initiator": agent(), "tool": "document.write", "reviewOp": { "op": "review" } })
}

fn observe_template(doc: DocId) -> Value {
    json!({ "doc": doc, "actor": human(), "initiator": human(), "postimage": SLOT, "observedParent": { "ref": "genesis" } })
}

#[test]
fn controlled_prepare_refuses_ill_formed_text_and_records_nothing() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    for (name, units, well_formed) in cases() {
        let doc = DocId::new();
        let before = w.journal_len();
        let res = w.prepare_json(&payload(prepare_template(doc, None), &units));
        if well_formed {
            // Genesis is the baseline (R3): only the empty text prepares
            // directly; the rest are STALE_PARENT, not INVALID_TEXT.
            let code = res.as_ref().err().map(|e| e.code());
            assert!(
                code.is_none() || code == Some("STALE_PARENT"),
                "{name}: {code:?}"
            );
            if let Ok(p) = res {
                w.abort(p.txn, "test").unwrap();
            }
        } else {
            assert_eq!(res.unwrap_err().code(), "INVALID_TEXT", "{name}");
            assert_eq!(w.journal_len(), before, "{name}: nothing appended");
            assert!(w.reservation(doc).is_none(), "{name}: nothing reserved");
        }
    }
}

#[test]
fn a_well_formed_preimage_round_trips_exactly() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    for (name, units, _) in cases().into_iter().filter(|c| c.2) {
        let doc = DocId::new();
        let text = String::from_utf16(&units).unwrap();
        let head = human_save(&w, doc, &text);
        let p = w
            .prepare_json(&payload(prepare_template(doc, Some(head)), &units))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        w.abort(p.txn, "test").unwrap();
        assert_eq!(
            head_text(&w, doc),
            text,
            "{name}: decoded without substitution"
        );
    }
}

#[test]
fn controlled_commit_refuses_ill_formed_text_and_keeps_the_reservation() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    for (name, units, _) in cases().into_iter().filter(|c| !c.2) {
        let doc = DocId::new();
        let p = w
            .prepare(prepare_req(
                doc,
                None,
                "",
                crate::agent_journal::review::ReviewOp::Review,
            ))
            .unwrap();
        let before = w.journal_len();
        let body = payload(json!({ "postimage": SLOT, "effects": {} }), &units);
        assert_eq!(
            w.commit_json(p.txn, &body).unwrap_err().code(),
            "INVALID_TEXT",
            "{name}"
        );
        assert_eq!(w.journal_len(), before, "{name}: nothing appended");
        assert!(
            w.reservation(doc).is_some(),
            "{name}: the caller still owns the transaction"
        );
        assert!(w.head(doc).is_none(), "{name}: no revision");
        w.abort(p.txn, "test").unwrap();
    }
}

#[test]
fn an_observational_capture_of_ill_formed_text_is_not_journaled() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    for (name, units, well_formed) in cases() {
        let doc = DocId::new();
        let before = w.journal_len();
        let reply = w
            .observe_json(&payload(observe_template(doc), &units))
            .unwrap();
        let wire = serde_json::to_value(&reply).unwrap();
        if well_formed {
            assert_eq!(wire["journaled"], "pending", "{name}");
            assert_eq!(w.pending_observations(doc).len(), 1, "{name}");
        } else {
            assert_eq!(
                wire,
                json!({ "journaled": "no", "reason": "INVALID_TEXT" }),
                "{name}"
            );
            assert_eq!(w.journal_len(), before, "{name}: nothing appended");
            assert!(
                w.pending_observations(doc).is_empty(),
                "{name}: nothing queued"
            );
            assert!(!w.is_degraded(doc), "{name}: not a degraded capture");
        }
    }
}

#[test]
fn malformed_json_and_raw_invalid_utf8_are_refused() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let mut raw = prepare_template(doc, None)
        .to_string()
        .replacen(SLOT, "a", 1)
        .into_bytes();
    let at = raw.iter().position(|&b| b == b'a').unwrap();
    raw[at] = 0xFF;
    assert_eq!(
        w.prepare_json(&raw).unwrap_err().code(),
        "INVALID_TEXT",
        "invalid UTF-8"
    );
    assert_eq!(w.prepare_json(b"{").unwrap_err().code(), "INVALID_REQUEST");
    let extra =
        prepare_template(doc, None)
            .to_string()
            .replacen("\"tool\"", "\"surprise\":1,\"tool\"", 1);
    assert_eq!(
        w.prepare_json(extra.as_bytes()).unwrap_err().code(),
        "INVALID_REQUEST",
        "unknown fields refused"
    );
    assert!(w.reservation(doc).is_none());
}

#[test]
fn a_payload_cut_off_after_a_high_surrogate_escape_is_invalid_text() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let doc = DocId::new();
    let full = String::from_utf8(payload(prepare_template(doc, None), &[0xD83D])).unwrap();
    // The text check runs before parsing, so the defect it names is the
    // lone surrogate at the end, not the truncated JSON.
    let cut = &full[..full.find("\\ud83d").unwrap() + 6];
    let before = w.journal_len();
    assert_eq!(
        w.prepare_json(cut.as_bytes()).unwrap_err().code(),
        "INVALID_TEXT"
    );
    assert_eq!(w.journal_len(), before);
}
