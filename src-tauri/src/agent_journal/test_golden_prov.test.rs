// WI-AL1.2 — provenance golden readers shared by the provenance parity suites
//! Readers for `src/test/fixtures/agentJournal/provenance.json` shared by the provenance golden
//! tests: the fixture itself, a replay of its transaction lists through the
//! Rust accumulator, payload encoding under the vector's ids, and the
//! byte-for-byte check against the file's own layout. A missing fixture or
//! key fails loudly; nothing here skips.

use crate::agent_journal::provenance::{BreakReason, Provenance, ProvenancePayload, Section};
use serde_json::Value;

fn path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/agentJournal/provenance.json")
}

pub fn golden_text() -> String {
    let text = std::fs::read_to_string(path())
        .unwrap_or_else(|e| panic!("golden fixture {} missing: {e}", path().display()));
    // The byte checks compare LF layouts; a CRLF checkout (Git for Windows'
    // autocrlf) would fail them all with a misleading diff.
    assert!(
        !text.contains('\r'),
        "golden fixture {} has CRLF line endings: .gitattributes must keep it eol=lf",
        path().display()
    );
    text
}

pub fn golden() -> Value {
    serde_json::from_str(&golden_text()).expect("golden fixture is JSON")
}

/// The non-empty array under `key` (a missing or empty key fails).
pub fn entries<'a>(g: &'a Value, key: &str) -> &'a Vec<Value> {
    let a = g[key]
        .as_array()
        .unwrap_or_else(|| panic!("golden key {key} is not an array"));
    assert!(!a.is_empty(), "golden key {key} is empty");
    a
}

pub fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} is not a string in {v}"))
}

pub fn utf16(s: &str) -> i64 {
    s.encode_utf16().count() as i64
}

pub fn int(v: &Value) -> i64 {
    v.as_i64().expect("integer")
}

pub fn reason(v: &Value) -> BreakReason {
    serde_json::from_value(v.clone()).expect("golden reason")
}

/// Applies a vector's transaction list to `p`.
pub fn apply_transactions(p: &mut Provenance, transactions: &Value) {
    for t in transactions.as_array().expect("transactions") {
        match s(t, "kind") {
            "certified" => {
                let sections: Vec<Section> = t["sections"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| Section {
                        from_a: int(&x["fromA"]),
                        to_a: int(&x["toA"]),
                        from_b: int(&x["fromB"]),
                        to_b: int(&x["toB"]),
                    })
                    .collect();
                p.compose(&sections).expect("certified transaction");
            }
            "breakRange" => {
                let ins = utf16(s(t, "insert"));
                p.break_range(
                    int(&t["fromA"]),
                    int(&t["toA"]),
                    ins,
                    reason(&t["reason"]),
                    s(t, "origin"),
                )
                .expect("bounded break");
            }
            "breakWhole" => {
                p.break_whole(utf16(s(t, "text")), reason(&t["reason"]), s(t, "origin"))
                    .expect("whole break");
            }
            other => panic!("unknown golden transaction kind {other}"),
        }
    }
}

/// Replays a `cases`-schema vector's transactions through a fresh accumulator.
pub fn replay(c: &Value) -> Provenance {
    let cap = c["cap"].as_u64().unwrap();
    let mut p = Provenance::new(utf16(s(c, "pre")), cap).expect("new accumulator");
    apply_transactions(&mut p, &c["transactions"]);
    p
}

/// `p` encoded under the vector's own document, epoch and basis.
pub fn encode(c: &Value, p: &Provenance) -> ProvenancePayload {
    let g = &c["payload"];
    ProvenancePayload::encode(
        s(g, "document"),
        s(g, "epoch"),
        s(g, "basis"),
        s(c, "pre"),
        s(c, "post"),
        p,
    )
    .expect("encode payload")
}

pub fn check_spans(name: &str, c: &Value, p: &Provenance) {
    for x in c["spans"].as_array().unwrap() {
        let (i, e) = (&x["input"], &x["expect"]);
        let m = p
            .map_span(
                int(&i["from"]),
                int(&i["to"]),
                i["growing"].as_bool().unwrap(),
            )
            .expect("map span");
        let got = serde_json::json!({
            "span": {"from": m.from, "to": m.to, "growing": m.growing},
            "hit": m.hit, "edited": m.edited, "block": m.block,
        });
        assert_eq!(&got, e, "{name}: span {i}");
    }
}

/// Byte-for-byte: the golden file is `JSON.stringify(_, null, 2)`, which
/// lays a value out exactly as `serde_json::to_string_pretty` does once
/// re-indented to the depth of `key` (`indent` spaces before the key).
pub fn assert_bytes<T: serde::Serialize>(
    text: &str,
    name: &str,
    key: &str,
    value: &T,
    indent: usize,
) {
    assert_pretty_bytes(
        text,
        name,
        key,
        &serde_json::to_string_pretty(value).unwrap(),
        indent,
    );
}

/// [`assert_bytes`] for an already-serialized `serde_json::to_string_pretty`
/// layout, so a caller can compare the writer's own bytes after renaming ids.
pub fn assert_pretty_bytes(text: &str, name: &str, key: &str, pretty: &str, indent: usize) {
    let pad = " ".repeat(indent);
    let pretty = pretty.replace('\n', &format!("\n{pad}"));
    let needle = format!("\n{pad}\"{key}\": {pretty}");
    assert!(
        text.contains(&needle),
        "{name}: {key} bytes differ from the golden file:\n{needle}"
    );
}
