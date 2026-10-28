// WI-AL1.2 — golden fixtures shared with TypeScript: hunk ids, u64 decimal strings, ill-formed text, transition matrix
//! R15 / R12 / R9 — the fixtures shared with the TypeScript spike
//! (`src/test/fixtures/agentJournal/*.json`, generated independently of both implementations).
//! A missing fixture fails loudly: it is the whole point of the test.
//!
//! - `hunkIds.json`: the canonical hunk id (preimage bytes and id), the
//!   text hash, and every invalid input refused.
//! - `u64.json`: `reviewGen` / generation as canonical decimal strings, both
//!   directions; JSON numbers and non-canonical strings refused.
//! - `unicode.json`: ill-formed text refused with `INVALID_TEXT` at the JSON
//!   boundary (never replaced with U+FFFD), well-formed text hashed exactly.
//! - `transitions.json`: the Rust matrix and its `reviewGen` bounds equal it.

use std::collections::BTreeMap;

use crate::agent_journal::hunk_id::{canonical_preimage, hunk_id, text_hash, HunkIdInput};
use crate::agent_journal::review::HunkState;
use crate::agent_journal::review_matrix::{class_bound, gen_class, ReviewEvent};
use crate::agent_journal::wire::check_json_text;
use serde_json::Value;

fn golden(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/agentJournal")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("golden fixture {} missing: {e}", path.display()));
    serde_json::from_str(&text).expect("golden fixture is JSON")
}

#[test]
fn hunk_ids_match_the_golden_cases() {
    let g = golden("hunkIds.json");
    let cases = g["cases"].as_array().unwrap();
    assert!(cases.len() >= 14);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        assert_eq!(
            text_hash(c["baseText"].as_str().unwrap()),
            c["baseTextHash"],
            "{name}"
        );
        assert_eq!(
            text_hash(c["targetText"].as_str().unwrap()),
            c["targetTextHash"],
            "{name}"
        );
        let input: HunkIdInput =
            serde_json::from_value(c.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            canonical_preimage(&input).unwrap(),
            c["preimage"].as_str().unwrap(),
            "{name}"
        );
        assert_eq!(
            hunk_id(&input).unwrap(),
            c["id"].as_str().unwrap(),
            "{name}"
        );
    }
}

#[test]
fn invalid_hunk_id_inputs_are_refused() {
    let g = golden("hunkIds.json");
    for c in g["invalid"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let mut input = c["input"].clone();
        if let Some(fields) = c.get("utf16Fields").and_then(Value::as_object) {
            // A lone surrogate cannot reach a Rust String: decoding refuses it.
            for (field, units) in fields {
                let units: Vec<u16> = serde_json::from_value(units.clone()).unwrap();
                assert!(String::from_utf16(&units).is_err(), "{name}");
                let escaped: String = units.iter().map(|u| format!("\\u{u:04x}")).collect();
                let json = input.to_string().replacen(
                    &format!("\"{field}\":\"{}\"", input[field].as_str().unwrap()),
                    &format!("\"{field}\":\"{escaped}\""),
                    1,
                );
                assert_eq!(
                    check_json_text(json.as_bytes()).unwrap_err().code(),
                    "INVALID_TEXT",
                    "{name}"
                );
                input[field] = Value::Null;
            }
            continue;
        }
        let refused = match serde_json::from_value::<HunkIdInput>(input) {
            Err(_) => true,
            Ok(parsed) => hunk_id(&parsed).is_err(),
        };
        assert!(refused, "{name} must be refused");
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Counter {
    #[serde(with = "crate::agent_journal::u64_wire")]
    review_gen: u64,
}

#[test]
fn u64_counters_are_decimal_strings_in_both_directions() {
    let g = golden("u64.json");
    for v in g["values"].as_array().unwrap() {
        let n: u64 = v["decimal"].as_str().unwrap().parse().unwrap();
        let wire = v["wire"].as_str().unwrap();
        assert_eq!(
            serde_json::to_string(&Counter { review_gen: n }).unwrap(),
            wire,
            "encode {n}"
        );
        assert_eq!(
            serde_json::from_str::<Counter>(wire).unwrap(),
            Counter { review_gen: n },
            "decode {wire}"
        );
    }
    for bad in g["invalidDecimals"].as_array().unwrap() {
        let wire = serde_json::json!({ "reviewGen": bad }).to_string();
        assert!(
            serde_json::from_str::<Counter>(&wire).is_err(),
            "{wire} must be refused"
        );
    }
    for bad in g["invalidWire"].as_array().unwrap() {
        assert!(
            serde_json::from_str::<Counter>(bad.as_str().unwrap()).is_err(),
            "{bad} must be refused"
        );
    }
}

#[test]
fn ill_formed_text_is_refused_at_the_json_boundary_and_never_replaced() {
    let g = golden("unicode.json");
    for c in g["cases"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let units: Vec<u16> = serde_json::from_value(c["utf16"].clone()).unwrap();
        let escaped: String = units.iter().map(|u| format!("\\u{u:04x}")).collect();
        let payload = format!("{{\"preimage\":\"{escaped}\"}}");
        let checked = check_json_text(payload.as_bytes());
        if c["wellFormed"].as_bool().unwrap() {
            checked.unwrap_or_else(|e| panic!("{name}: {e}"));
            let text: String =
                serde_json::from_value::<Value>(serde_json::from_str(&payload).unwrap()).unwrap()
                    ["preimage"]
                    .as_str()
                    .unwrap()
                    .into();
            assert_eq!(
                text,
                String::from_utf16(&units).unwrap(),
                "{name}: decoded exactly"
            );
            assert_eq!(
                crate::agent_journal::ids::hex(text.as_bytes()),
                c["utf8Hex"].as_str().unwrap(),
                "{name}"
            );
            assert_eq!(text_hash(&text), c["textHash"].as_str().unwrap(), "{name}");
        } else {
            assert_eq!(
                checked.unwrap_err().code(),
                c["controlled"].as_str().unwrap(),
                "{name}"
            );
            assert!(
                serde_json::from_str::<Value>(&payload).is_err(),
                "{name}: serde_json never substitutes U+FFFD"
            );
        }
    }
}

fn state(name: &str) -> HunkState {
    serde_json::from_value(Value::String(name.into()))
        .unwrap_or_else(|e| panic!("state {name}: {e}"))
}

#[test]
fn the_rust_transition_matrix_equals_the_shared_one() {
    let g = golden("transitions.json");
    let mut want: BTreeMap<String, BTreeMap<String, String>> =
        serde_json::from_value(g["transitions"].clone()).unwrap();
    let mut have: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let states: Vec<String> = serde_json::from_value(g["states"].clone()).unwrap();
    for ev in ReviewEvent::ALL {
        let row = have.entry(ev.name().into()).or_default();
        for from in &states {
            if let Some(to) = ev.target(state(from)) {
                let to = serde_json::to_value(to)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string();
                row.insert(from.clone(), to);
            }
        }
    }
    let user: Vec<String> = serde_json::from_value(g["userEvents"].clone()).unwrap();
    let capture: Vec<String> = serde_json::from_value(g["captureEvents"].clone()).unwrap();
    let names: Vec<String> = ReviewEvent::ALL
        .iter()
        .map(|e| e.name().to_string())
        .collect();
    assert_eq!(names, [user, capture].concat(), "the same events");
    want.retain(|_, row| !row.is_empty());
    have.retain(|_, row| !row.is_empty());
    assert_eq!(have, want);
    for f in g["forbidden"].as_array().unwrap() {
        let (from, to) = (
            state(f["from"].as_str().unwrap()),
            state(f["to"].as_str().unwrap()),
        );
        assert!(
            ReviewEvent::ALL.iter().all(|e| e.target(from) != Some(to)),
            "{f}"
        );
    }
}

#[test]
fn review_gen_bounds_equal_the_shared_classes() {
    let g = golden("transitions.json");
    let bound = |class: &str| -> u64 {
        let s = g["genBounds"][class]["allowedWhileGenAtMost"]
            .as_str()
            .unwrap();
        let k: u64 = s.strip_prefix("u64::MAX-").unwrap().parse().unwrap();
        u64::MAX - k
    };
    for ev in ReviewEvent::ALL {
        for from in [
            HunkState::Pending,
            HunkState::Kept,
            HunkState::Reverted,
            HunkState::Conflicted,
            HunkState::Superseded,
            HunkState::ResolvedByHumanEdit,
        ] {
            let Some(to) = ev.target(from) else { continue };
            let (class, rust_bound) = (gen_class(ev, to), class_bound(gen_class(ev, to)));
            assert_eq!(
                rust_bound,
                bound(class.name()),
                "{} {from:?} → {to:?}",
                ev.name()
            );
        }
    }
    assert_eq!(g["genBounds"]["refusalCode"], "REVIEW_STATE_EXHAUSTED");
}
