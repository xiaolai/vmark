// WI-1.1 — volume-sweep driver helpers + the resume cursor read end-to-end.

use super::*;
use crate::coherence::index::CoherenceIndex;
use crate::coherence::types::{Envelope, WriterId};

// ---- checkability -----------------------------------------------------------

#[test]
fn only_version_stale_edges_are_checkable() {
    assert!(is_checkable(&EdgeState::VersionStale));
    assert!(is_checkable(&EdgeState::StaleValid));
    assert!(is_checkable(&EdgeState::StaleContradicted));
    assert!(is_checkable(&EdgeState::StaleUnknown));
    // Not checkable: nothing to check, or no single upstream revision.
    assert!(!is_checkable(&EdgeState::Fresh {
        ratified: false,
        ahead: false
    }));
    assert!(!is_checkable(&EdgeState::Waived));
    assert!(!is_checkable(&EdgeState::Diverged { multi_head: true }));
    assert!(!is_checkable(&EdgeState::Unpinnable));
}

// ---- cost model table -------------------------------------------------------

#[test]
fn cost_model_table_maps_families_and_defaults_high() {
    assert_eq!(cost_model_for("claude-haiku-4-5").usd_per_1k_tokens, 0.004);
    assert_eq!(cost_model_for("claude-sonnet-5").usd_per_1k_tokens, 0.009);
    assert_eq!(cost_model_for("claude-opus-4-8").usd_per_1k_tokens, 0.03);
    // Unknown model → the conservative default, never free.
    assert_eq!(
        cost_model_for("some-unlisted-model"),
        super::super::check_sweep::DEFAULT_RATE
    );
    assert!(cost_model_for("mystery").usd_per_1k_tokens > 0.0);
}

#[test]
fn per_check_cost_grows_with_prompt_size() {
    let m = cost_model_for("claude-opus-4-8");
    let small = estimate_check_cost(1_000, m);
    let large = estimate_check_cost(30_000, m);
    assert!(large > small);
    assert!(small > 0.0);
}

// ---- cursor mapping ---------------------------------------------------------

#[test]
fn cursor_from_index_maps_tuples_to_keys() {
    let txf = uuid::Uuid::now_v7();
    let rows = vec![(txf, 0u32, "rev1:aa".to_string(), "fp1".to_string())];
    let keys = cursor_from_index(rows);
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].txf, txf.to_string());
    assert_eq!(keys[0].input, 0);
    assert_eq!(keys[0].checked_against, "rev1:aa");
    assert_eq!(keys[0].claims_fingerprint, "fp1");
}

// ---- resume cursor read, end-to-end through a real index --------------------

fn check_result_envelope(
    writer: WriterId,
    txf: &uuid::Uuid,
    input: u32,
    checked_against: &str,
    fingerprint: Option<&str>,
) -> Envelope {
    let pinned = "rev1:1111111111111111111111111111111111111111111111111111111111111111";
    let mut body = serde_json::json!({
        "edge": { "txf": txf.to_string(), "input": input },
        "pinned": pinned,
        "checked_against": checked_against,
        "verdict": "no-contradiction",
        "context": "00000000-0000-0000-0000-000000000000",
    });
    if let Some(fp) = fingerprint {
        body["claims_fingerprint"] = serde_json::json!(fp);
    }
    Envelope::create("check-result", writer, body)
}

#[test]
fn checked_cursor_reads_fingerprinted_results_and_skips_bare_ones() {
    let (mut index, _) = CoherenceIndex::open_in_memory().expect("index");
    let writer = WriterId(uuid::Uuid::now_v7());
    let txf = uuid::Uuid::now_v7();
    let against = "rev1:2222222222222222222222222222222222222222222222222222222222222222";

    // One fingerprinted result (a real resume key) ...
    index
        .apply_entry(&check_result_envelope(
            writer,
            &txf,
            0,
            against,
            Some("fp-A"),
        ))
        .expect("apply fingerprinted");
    // ... and one WITHOUT a fingerprint (pre-revision-1 history — must be skipped).
    index
        .apply_entry(&check_result_envelope(writer, &txf, 1, against, None))
        .expect("apply bare");

    let cursor = cursor_from_index(index.checked_cursor().expect("cursor"));
    assert_eq!(
        cursor.len(),
        1,
        "only the fingerprinted result seeds the cursor"
    );
    assert_eq!(cursor[0].input, 0);
    assert_eq!(cursor[0].checked_against, against);
    assert_eq!(cursor[0].claims_fingerprint, "fp-A");
}

// ---- config -----------------------------------------------------------------

#[test]
fn config_builds_a_seeded_plan_and_backoff() {
    let cfg = SweepConfig {
        ceiling_usd: 5.0,
        backoff_base_ms: 250,
        backoff_max_ms: 8000,
        cost_model: cost_model_for("claude-sonnet-5"),
    };
    let done = CheckedKey {
        txf: "t".into(),
        input: 0,
        checked_against: "rev1:aa".into(),
        claims_fingerprint: "fp".into(),
    };
    let plan = cfg.new_plan(vec![done.clone()]);
    assert!(!plan.should_check(&done)); // seeded from the cursor
    assert_eq!(plan.budget.ceiling_usd, 5.0);
    assert_eq!(cfg.new_backoff().delay_ms(), 250);
    assert_eq!(cfg.cost_model.usd_per_1k_tokens, 0.009);
}
