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
fn empty_or_whitespace_quote_is_not_evidence() {
    // Audit C2: an empty or whitespace-only quote must not satisfy the
    // contradiction-needs-a-quote discipline — the verdict downgrades.
    for quote in ["", "   ", "\t\n"] {
        let raw = format!(
            r#"{{"verdict":"contradiction","confidence":0.99,"evidence":[{{"quote":"{quote}","loc":"L1"}}]}}"#
        );
        let p = parse(&raw);
        assert_eq!(
            p.verdict,
            CheckVerdict::Unknown,
            "blank quote {quote:?} must not count as evidence"
        );
        assert!(p.evidence.is_empty(), "blank quote {quote:?} filtered out");
    }
}

#[test]
fn out_of_range_or_nonfinite_confidence_is_unknown() {
    // Audit C3: a confidence outside [0,1] or non-finite is no signal —
    // it must never earn a determinate verdict, even with valid evidence.
    for conf in ["2.0", "-0.5", "1.0e400"] {
        let raw = format!(r#"{{"verdict":"no-contradiction","confidence":{conf},"evidence":[]}}"#);
        let p = parse(&raw);
        assert_eq!(
            p.verdict,
            CheckVerdict::Unknown,
            "confidence {conf} rejected"
        );
        assert_eq!(p.confidence, 0.0, "no-signal confidence resets to 0.0");
    }
}

#[test]
fn claims_are_capped_in_prompt() {
    // Audit C1: an unbounded claim list must not bloat the prompt — only
    // the first MAX_CLAIMS are interpolated.
    let claims: Vec<String> = (0..MAX_CLAIMS + 20)
        .map(|i| format!("claim-number-{i}"))
        .collect();
    let prompt = build_check_prompt(&CheckPromptInput {
        upstream_path: "a.md",
        pinned_text: "x",
        current_text: "y",
        downstream_path: "b.md",
        downstream_text: "z",
        claims: &claims,
        nonce: "n",
    });
    assert!(prompt.contains(&format!("claim-number-{}", MAX_CLAIMS - 1)));
    assert!(
        !prompt.contains(&format!("claim-number-{MAX_CLAIMS}")),
        "claims past the cap must be dropped"
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

// WI-3.0d — transient candidate-check prompt (design D3). Proposal-vs-inputs/
// canon consistency, distinct from the stale-edge drift prompt.

#[test]
fn candidate_response_parses_with_the_same_discipline() {
    // Reuses parse_check_response: a contradiction still needs evidence.
    let p = parse(r#"{"verdict":"contradiction","confidence":0.99,"evidence":[]}"#);
    assert_eq!(p.verdict, CheckVerdict::Unknown);
}

#[test]
fn a_below_tau_verdict_is_downgraded_but_preserved() {
    // Dogfood 2026-07-20: 5 of 21 real checks returned `unknown` with empty
    // evidence, and the confidences split PERFECTLY at τ — determinate 0.90–0.99,
    // unknown 0.82–0.86, nothing between. Every one was a τ downgrade of a verdict
    // the model had actually reached, and the old code discarded both the verdict
    // and its evidence. That made the τ choice irreversible: lowering it later
    // could not recover answers already paid for. Downgrade, but PRESERVE.
    let p = parse(
        r#"{"verdict":"no-contradiction","confidence":0.86,
            "evidence":[{"quote":"the canon says green","loc":"L3"}]}"#,
    );
    assert_eq!(
        p.verdict,
        CheckVerdict::Unknown,
        "still disciplined to unknown"
    );
    assert!(
        p.evidence.is_empty(),
        "the recorded verdict carries no evidence"
    );

    let d = p.downgrade.expect("the model's actual answer is preserved");
    assert_eq!(d.verdict, CheckVerdict::NoContradiction);
    assert_eq!(d.reason, "below-tau");
    assert_eq!(d.tau, TAU);
    assert_eq!(d.evidence.len(), 1, "and so is the evidence it cited");
    assert_eq!(d.evidence[0].quote, "the canon says green");
}

#[test]
fn a_contradiction_without_evidence_records_why_it_was_downgraded() {
    let p = parse(r#"{"verdict":"contradiction","confidence":0.99,"evidence":[]}"#);
    assert_eq!(p.verdict, CheckVerdict::Unknown);
    let d = p.downgrade.expect("preserved");
    assert_eq!(d.verdict, CheckVerdict::Contradiction);
    assert_eq!(d.reason, "contradiction-without-evidence");
}

#[test]
fn an_unparseable_response_has_nothing_to_preserve() {
    // A malformed response is a real non-answer — distinct from a τ downgrade.
    // It must NOT masquerade as a preserved verdict.
    let p = parse("the model said something conversational");
    assert_eq!(p.verdict, CheckVerdict::Unknown);
    assert_eq!(p.confidence, 0.0);
    assert!(p.downgrade.is_none(), "no verdict was ever reached");
}

#[test]
fn resolve_tau_clamps_unusable_thresholds() {
    use crate::coherence::check_commands::{resolve_tau, DEFAULT_TAU};
    assert_eq!(resolve_tau(Some(0.8)), 0.8, "a usable τ is honoured");
    assert_eq!(resolve_tau(None), DEFAULT_TAU);
    // Out of range is not a threshold: τ≤0 would make every verdict determinate
    // and τ>1 would make every verdict unknown. Fall back rather than do either.
    assert_eq!(resolve_tau(Some(-0.5)), DEFAULT_TAU);
    assert_eq!(resolve_tau(Some(1.5)), DEFAULT_TAU);
    assert_eq!(resolve_tau(Some(f64::NAN)), DEFAULT_TAU);
}
