//! Claim lifecycle (WI-2b.2; spec §5.4.5 revision 1, design-2a.md D2/D4).
//! Pure (ADR-C4 kernel tier): parses `claim` ledger entries into a
//! per-claim view with deterministic current-entry resolution, the D4
//! feed matrix, and the D5.6 claims fingerprint. Malformed entries are
//! skipped here (they were already quarantine-validated at read time);
//! anything ambiguous resolves fail-loud via `conflicts()`.

use std::collections::HashMap;

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::types::Envelope;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Maturity {
    Draft,
    Established,
}

/// One claim entry, parsed. `entry_id` is the envelope id; `claim` is
/// the stable claim-object id (D2 — they are deliberately distinct).
#[derive(Debug, Clone)]
pub struct ClaimEntry {
    pub entry_id: Uuid,
    pub claim: Uuid,
    pub statement: String,
    pub maturity: Maturity,
    pub invalid_at: Option<String>,
    pub supersedes: Option<Uuid>,
    /// Reader total-order key (spec §5.1) for deterministic resolution.
    sort_key: (chrono::DateTime<chrono::FixedOffset>, Uuid),
}

/// A concurrent-supersession conflict (D2.1): two surviving entries
/// superseded the same predecessor. Surfaced, never hidden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimConflict {
    pub claim: Uuid,
    pub superseded: Uuid,
    pub rivals: Vec<Uuid>,
}

#[derive(Debug, Default)]
pub struct ClaimStore {
    /// claim id → its entries in reader total order.
    by_claim: HashMap<Uuid, Vec<ClaimEntry>>,
    conflicts: Vec<ClaimConflict>,
}

impl ClaimStore {
    /// Build from ledger entries (any kinds — non-claim kinds are
    /// ignored). Entries must already be deduped by idem (spec §5.1).
    pub fn from_entries(entries: &[Envelope]) -> Self {
        let mut by_claim: HashMap<Uuid, Vec<ClaimEntry>> = HashMap::new();
        for env in entries {
            if env.kind != "claim" {
                continue;
            }
            let Some(parsed) = parse_claim(env) else {
                continue; // malformed known-kind was quarantined at read
            };
            by_claim.entry(parsed.claim).or_default().push(parsed);
        }
        let mut conflicts = Vec::new();
        for (claim, list) in by_claim.iter_mut() {
            list.sort_by_key(|e| e.sort_key);
            // D2.1: two entries superseding the same predecessor is a
            // conflict — both survive, reader order decides currency.
            let mut by_target: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
            for e in list.iter() {
                if let Some(target) = e.supersedes {
                    by_target.entry(target).or_default().push(e.entry_id);
                }
            }
            for (superseded, rivals) in by_target {
                if rivals.len() > 1 {
                    conflicts.push(ClaimConflict {
                        claim: *claim,
                        superseded,
                        rivals,
                    });
                }
            }
        }
        conflicts.sort_by_key(|c| c.claim);
        Self {
            by_claim,
            conflicts,
        }
    }

    /// D2.1: the current entry is the one not named by any other entry's
    /// `supersedes`; ties (concurrent supersession) resolve to the
    /// latest in reader total order.
    pub fn current(&self, claim: Uuid) -> Option<&ClaimEntry> {
        let list = self.by_claim.get(&claim)?;
        let superseded: std::collections::HashSet<Uuid> =
            list.iter().filter_map(|e| e.supersedes).collect();
        list.iter()
            .rev() // latest in reader order first
            .find(|e| !superseded.contains(&e.entry_id))
    }

    pub fn all_current(&self) -> Vec<&ClaimEntry> {
        let mut out: Vec<&ClaimEntry> = self
            .by_claim
            .keys()
            .filter_map(|c| self.current(*c))
            .collect();
        out.sort_by_key(|e| e.sort_key);
        out
    }

    pub fn conflicts(&self) -> &[ClaimConflict] {
        &self.conflicts
    }

    /// D4 feed matrix: established ∧ visible ∧ transaction-current ∧
    /// not invalidated. `visible` is the context's effective claim set
    /// (contexts::ContextSet::effective_claims).
    pub fn is_fed(&self, claim: Uuid, visible: &[Uuid]) -> bool {
        if !visible.contains(&claim) {
            return false;
        }
        match self.current(claim) {
            Some(e) => e.maturity == Maturity::Established && e.invalid_at.is_none(),
            None => false,
        }
    }

    /// The fed set for a context, in stable (claim id) order.
    pub fn fed_claims(&self, visible: &[Uuid]) -> Vec<&ClaimEntry> {
        let mut out: Vec<&ClaimEntry> = visible
            .iter()
            .filter(|c| self.is_fed(**c, visible))
            .filter_map(|c| self.current(*c))
            .collect();
        out.sort_by_key(|e| e.claim);
        out
    }

    /// D5.6: SHA-256 over the sorted `(claim-id, current-entry-id)`
    /// pairs fed; the empty feed hashes the empty string.
    pub fn claims_fingerprint(&self, visible: &[Uuid]) -> String {
        let mut hasher = Sha256::new();
        for e in self.fed_claims(visible) {
            hasher.update(e.claim.to_string().as_bytes());
            hasher.update(b"=");
            hasher.update(e.entry_id.to_string().as_bytes());
            hasher.update(b"\n");
        }
        format!("sha256:{:x}", hasher.finalize())
    }
}

fn parse_claim(env: &Envelope) -> Option<ClaimEntry> {
    let b = &env.body;
    let claim = Uuid::parse_str(b.get("claim")?.as_str()?).ok()?;
    let statement = b.get("statement")?.as_str()?.to_string();
    // Unknown maturity values degrade to draft — an unrecognized state
    // must never gain the power to constrain (D4).
    let maturity = match b.get("maturity").and_then(|v| v.as_str()) {
        Some("established") => Maturity::Established,
        _ => Maturity::Draft,
    };
    let invalid_at = b
        .get("invalid_at")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let supersedes = b
        .get("supersedes")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    let sort_key = env.sort_key()?;
    Some(ClaimEntry {
        entry_id: env.id,
        claim,
        statement,
        maturity,
        invalid_at,
        supersedes,
        sort_key,
    })
}

#[cfg(test)]
#[path = "claims.test.rs"]
mod tests;
