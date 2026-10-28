// WI-AL2.2g — the page lifecycle's diagnostic traces: a started load and a destroyed window each log their label; a registration logs its label, the identity it registered, the generation it was given and the pair it replaced; a refused registration logs its label and journal code, never the raw identity the webview sent
//! The traces a native run reads to correlate each document's identity
//! with the `Started` and register events Rust saw.

use crate::agent_journal::admission::lifecycle_support::life_inline;
use crate::agent_journal::admission::page_events::register_page;
use crate::peer_text::log_capture::captured_logs;

fn one_line(lines: &[String], needle: &str) -> String {
    let hits: Vec<&String> = lines.iter().filter(|l| l.contains(needle)).collect();
    assert_eq!(hits.len(), 1, "one `{needle}` trace in {lines:?}");
    hits[0].clone()
}

#[test]
fn a_started_load_and_a_destroyed_window_trace_their_label() {
    let l = life_inline();
    let lines = captured_logs(|| {
        l.started("doc-trace");
        l.destroyed("doc-trace");
    });
    assert!(one_line(&lines, "page load started").contains("doc-trace"));
    assert!(one_line(&lines, "window destroyed").contains("doc-trace"));
}

#[test]
fn a_registration_traces_its_identity_generation_and_replaced_pair() {
    let l = life_inline();
    let old = l.r.page("doc-trace", 1);
    let mut fresh = None;
    let lines = captured_logs(|| fresh = Some(l.replace(&old, 2)));
    let fresh = fresh.expect("replaced");
    let line = one_line(&lines, "page registered");
    for part in [
        "doc-trace",
        fresh.identity.as_str(),
        &format!("generation {}", fresh.generation),
        &format!("replaces {} generation {}", old.identity, old.generation),
    ] {
        assert!(line.contains(part), "`{part}` in {line}");
    }
}

#[test]
fn a_refused_registration_traces_its_code_not_the_raw_identity() {
    let l = life_inline();
    l.r.pages.started("doc-trace");
    let raw = "not-an-identity\nforged line";
    let lines = captured_logs(|| {
        let e = register_page(
            &l.r.pages,
            &l.worker,
            Some(&l.r.c.writer),
            "doc-trace",
            raw,
            None,
            l.pass(),
        );
        assert!(e.is_err(), "a malformed identity is refused");
    });
    let line = one_line(&lines, "page registration refused");
    assert!(
        line.contains("doc-trace") && line.contains("INVALID_REQUEST"),
        "{line}"
    );
    assert!(
        lines.iter().all(|l| !l.contains("forged line")),
        "{lines:?}"
    );
}
