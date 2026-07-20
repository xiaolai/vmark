//! Coherence logbook (dogfood-driven, 2026-07-20) — the record that makes M2
//! (staleness relevance) and M4 (resolution burden) judgeable.
//!
//! Almost entirely a PROJECTION over the append-only ledger. Flags, check
//! verdicts, ratifications and waivers are already durable facts, so an edge's
//! whole story reconstructs retroactively — including history recorded long
//! before this module existed (validated against 150 real entries: 28 edge
//! stories, no new storage).
//!
//! Two things the raw ledger does NOT make obvious, both found by dogfooding:
//!
//! - **Churn.** The same edges were ratified 3× each. M4's per-session burden is
//!   therefore REPETITION, not breadth — few edges reopening, not many edges once.
//!   `resolutions` counts that directly, so "this edge has cost you 3
//!   ratifications" becomes visible instead of buried in a flat entry list.
//! - **What the checker actually concluded.** A τ-downgraded check records
//!   `unknown`; the preserved `downgraded` verdict is surfaced alongside it, so a
//!   "no signal" row can be told apart from "the model answered, just below τ".
//!
//! The ONE fact the ledger cannot already answer is whether a flag was WORTH
//! surfacing. That is a human judgment, so it gets its own append-only
//! `flag-judgment` entry rather than being inferred from behaviour.

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::state::WorkspaceKernel;
use super::types::Envelope;

/// One check as the log shows it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogCheck {
    pub time: String,
    /// The RECORDED verdict (what discipline allowed).
    pub verdict: String,
    pub confidence: f64,
    /// What the model actually concluded, when τ (or the evidence rule)
    /// downgraded it. `None` for a determinate verdict or a real non-answer.
    pub downgraded_verdict: Option<String>,
    pub downgrade_reason: Option<String>,
}

/// The owner's answer to "was surfacing this flag worth it?" — the M2 datum.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlagJudgment {
    pub time: String,
    /// `relevant` | `noise` | `unsure`.
    pub judgment: String,
    pub note: String,
}

/// One row per edge — its whole life, oldest activity first.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub txf: String,
    pub input: u32,
    pub first_activity: String,
    /// Times this edge was resolved. >1 means it REOPENED and was paid for
    /// again — the re-coherence tax, and the driver of M4's burden.
    pub resolutions: usize,
    pub last_resolution: Option<String>,
    pub checks: Vec<LogCheck>,
    /// Latest owner judgment; the newest entry wins (judgments are revisable).
    pub judgment: Option<FlagJudgment>,
}

fn edge_key(body: &serde_json::Value) -> Option<(String, u32)> {
    let e = body.get("edge")?;
    let txf = e.get("txf")?.as_str()?.to_string();
    let input = u32::try_from(e.get("input")?.as_u64()?).ok()?;
    Some((txf, input))
}

/// Project the logbook from ledger entries. Pure — no IO, no kernel — so it is
/// testable in isolation and cheap to recompute.
///
/// Entries are assumed deduped and (time, id)-sorted, exactly as `read_all`
/// returns them; the projection preserves that order per edge.
pub fn project_logbook(entries: &[Envelope]) -> Vec<LogEntry> {
    let mut rows: Vec<LogEntry> = Vec::new();
    let mut index: std::collections::HashMap<(String, u32), usize> =
        std::collections::HashMap::new();

    for e in entries {
        let Some(key) = edge_key(&e.body) else {
            continue;
        };
        let slot = *index.entry(key.clone()).or_insert_with(|| {
            rows.push(LogEntry {
                txf: key.0.clone(),
                input: key.1,
                first_activity: e.time.clone(),
                resolutions: 0,
                last_resolution: None,
                checks: Vec::new(),
                judgment: None,
            });
            rows.len() - 1
        });
        let row = &mut rows[slot];
        match e.kind.as_str() {
            "check-result" => {
                let d = e.body.get("downgraded");
                row.checks.push(LogCheck {
                    time: e.time.clone(),
                    verdict: e
                        .body
                        .get("verdict")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    confidence: e
                        .body
                        .get("confidence")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    downgraded_verdict: d
                        .and_then(|d| d.get("verdict"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    downgrade_reason: d
                        .and_then(|d| d.get("reason"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                });
            }
            "ratification" | "waiver" => {
                row.resolutions += 1;
                row.last_resolution = Some(e.kind.clone());
            }
            "flag-judgment" => {
                // Newest wins — a judgment is revisable, and entries arrive in
                // (time, id) order, so a later one simply overwrites.
                row.judgment = Some(FlagJudgment {
                    time: e.time.clone(),
                    judgment: e
                        .body
                        .get("judgment")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unsure")
                        .to_string(),
                    note: e
                        .body
                        .get("note")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                });
            }
            _ => {}
        }
    }
    rows
}

/// The three answers M2 accepts. Anything else is refused at the boundary rather
/// than silently coerced — a mis-typed judgment would quietly corrupt the metric.
pub const JUDGMENTS: [&str; 3] = ["relevant", "noise", "unsure"];

/// Max note length. Generous for a human remark, bounded so a judgment can never
/// approach the ledger's line cap.
const MAX_NOTE_BYTES: usize = 4 * 1024;

/// Append the owner's relevance judgment for one flagged edge (the M2 datum).
/// Append-only and revisable: a later judgment supersedes an earlier one, and
/// both stay in history.
pub fn append_flag_judgment(
    kernel: &mut WorkspaceKernel,
    txf: &Uuid,
    input: u32,
    judgment: &str,
    note: &str,
) -> Result<Uuid, String> {
    if !JUDGMENTS.contains(&judgment) {
        return Err(format!(
            "unknown judgment {judgment:?} — expected one of {JUDGMENTS:?}"
        ));
    }
    if note.len() > MAX_NOTE_BYTES {
        return Err(format!(
            "judgment note is {} bytes, over the {MAX_NOTE_BYTES} cap",
            note.len()
        ));
    }
    kernel.with_write_lock(|kernel| {
        // The edge must exist: judging a flag that was never raised would put a
        // phantom row in the M2 denominator.
        if kernel.index().edge_by(txf, input)?.is_none() {
            return Err(format!("no such edge: {txf}#{input}"));
        }
        let env = Envelope::create(
            "flag-judgment",
            kernel.writer(),
            json!({
                "edge": { "txf": txf.to_string(), "input": input },
                "judgment": judgment,
                "note": note,
            }),
        );
        let id = env.id;
        kernel.append_and_apply(&env)?;
        Ok(id)
    })
}

/// M2 at a glance: how many surfaced flags the owner judged each way. The
/// denominator is judged edges — NOT all edges — so an unjudged backlog can
/// never inflate a relevance rate.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct M2Summary {
    pub relevant: usize,
    pub noise: usize,
    pub unsure: usize,
    pub unjudged: usize,
}

pub fn m2_summary(rows: &[LogEntry]) -> M2Summary {
    let mut s = M2Summary::default();
    for r in rows {
        match r.judgment.as_ref().map(|j| j.judgment.as_str()) {
            Some("relevant") => s.relevant += 1,
            Some("noise") => s.noise += 1,
            Some("unsure") => s.unsure += 1,
            _ => s.unjudged += 1,
        }
    }
    s
}

#[cfg(test)]
#[path = "logbook.test.rs"]
mod tests;
