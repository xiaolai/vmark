//! Claim ledger-entry shaping: maturity naming and the entry body a claim appends.
//!
//! Split out of `claim_commands.rs` for size. These translate a claim into its
//! durable representation; the command surface stays in the parent.
//!
//! @coordinates-with claim_commands.rs — the module this was split from
//! @module coherence/claim_entry

use serde_json::json;
use uuid::Uuid;

use super::claims::Maturity;

pub(super) fn maturity_str(e: &super::claims::ClaimEntry) -> &'static str {
    match e.maturity {
        Maturity::Draft => "draft",
        Maturity::Established => "established",
    }
}

pub(super) fn entry_body(
    claim: Uuid,
    statement: &str,
    maturity: &str,
    invalid_at: Option<String>,
    current: &super::claims::ClaimEntry,
    actor: &str,
) -> serde_json::Value {
    json!({
        "claim": claim.to_string(),
        "statement": statement,
        "valid_at": null,
        "invalid_at": invalid_at,
        "established_by": [],
        "supersedes": current.entry_id.to_string(),
        "maturity": maturity,
        "actor": { "type": "human", "id": actor },
    })
}
