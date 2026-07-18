// WI-2b.4 — pure checker: prompt construction and verdict-discipline
// parsing (design-2a.md D5.3; spike S4 findings; spec §5.4.4 revision 1).

use super::*;
use crate::coherence::project::CheckVerdict;

const TAU: f64 = 0.9;

fn parse(raw: &str) -> ParsedCheck {
    parse_check_response(raw, TAU)
}

#[test]
fn valid_contradiction_with_evidence_passes() {
    let p = parse(
        r#"{"verdict":"contradiction","confidence":0.95,
            "evidence":[{"quote":"her brown eyes","loc":"L12"}]}"#,
    );
    assert_eq!(p.verdict, CheckVerdict::Contradiction);
    assert_eq!(p.evidence.len(), 1);
}

#[test]
fn contradiction_without_evidence_downgrades_to_unknown() {
    let p = parse(r#"{"verdict":"contradiction","confidence":0.99,"evidence":[]}"#);
    assert_eq!(p.verdict, CheckVerdict::Unknown, "S4: no quote, no verdict");
}

#[test]
fn confidence_below_tau_downgrades_to_unknown() {
    let p = parse(
        r#"{"verdict":"contradiction","confidence":0.5,
            "evidence":[{"quote":"q","loc":"L1"}]}"#,
    );
    assert_eq!(p.verdict, CheckVerdict::Unknown);
    let p2 = parse(r#"{"verdict":"no-contradiction","confidence":0.5,"evidence":[]}"#);
    assert_eq!(p2.verdict, CheckVerdict::Unknown);
}

#[test]
fn no_contradiction_at_tau_passes() {
    let p = parse(r#"{"verdict":"no-contradiction","confidence":0.9,"evidence":[]}"#);
    assert_eq!(p.verdict, CheckVerdict::NoContradiction);
}

#[test]
fn malformed_or_unknown_verdicts_are_unknown() {
    for raw in [
        "not json at all",
        r#"{"verdict":"maybe","confidence":0.99,"evidence":[]}"#,
        r#"{"confidence":0.99}"#,
        "",
    ] {
        assert_eq!(parse(raw).verdict, CheckVerdict::Unknown, "raw: {raw:?}");
    }
}

#[test]
fn json_inside_code_fence_is_extracted() {
    let p = parse(
        "Here is my analysis:\n```json\n{\"verdict\":\"no-contradiction\",\"confidence\":0.93,\"evidence\":[]}\n```\n",
    );
    assert_eq!(p.verdict, CheckVerdict::NoContradiction);
}

#[test]
fn evidence_is_capped_and_quotes_truncated() {
    let quotes: Vec<String> = (0..10)
        .map(|i| format!(r#"{{"quote":"{}","loc":"L{i}"}}"#, "x".repeat(2000)))
        .collect();
    let raw = format!(
        r#"{{"verdict":"contradiction","confidence":0.95,"evidence":[{}]}}"#,
        quotes.join(",")
    );
    let p = parse(&raw);
    assert!(p.evidence.len() <= MAX_EVIDENCE);
    assert!(p.evidence.iter().all(|e| e.quote.len() <= MAX_QUOTE_CHARS));
}

#[test]
fn prompt_contains_fenced_texts_and_claims() {
    let prompt = build_check_prompt(&CheckPromptInput {
        upstream_path: "elena.md",
        pinned_text: "Her eyes were green.",
        current_text: "Her eyes were brown.",
        downstream_path: "scene-12.md",
        downstream_text: "Elena's green eyes watched the tide.",
        claims: &[("Elena is left-handed".to_string())],
        nonce: "abc123",
    });
    for needle in [
        "elena.md",
        "scene-12.md",
        "Her eyes were green.",
        "Her eyes were brown.",
        "Elena is left-handed",
        "abc123",
        "no-contradiction",
    ] {
        assert!(prompt.contains(needle), "prompt missing {needle:?}");
    }
    // Untrusted document text must be fenced with the nonce.
    assert!(
        prompt.matches("abc123").count() >= 6,
        "fences around each text"
    );
}

#[test]
fn oversized_texts_are_truncated_with_marker() {
    let big = "y".repeat(MAX_TEXT_CHARS + 500);
    let prompt = build_check_prompt(&CheckPromptInput {
        upstream_path: "a.md",
        pinned_text: &big,
        current_text: "short",
        downstream_path: "b.md",
        downstream_text: "short",
        claims: &[],
        nonce: "n",
    });
    assert!(prompt.contains("[truncated]"));
    assert!(prompt.len() < big.len() + 4000);
}
