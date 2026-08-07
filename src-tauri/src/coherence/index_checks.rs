//! Live check-result loading (WI-2b.3, split from `index_query.rs` for
//! the file-size gate). D5.6: a result is live only under the exact
//! (context, claims-fingerprint) snapshot that produced it.

use uuid::Uuid;

use super::index::CoherenceIndex;
use super::project::{CheckVerdict, EdgeCheck};
use super::types::RevisionId;

impl CoherenceIndex {
    /// Live check-results for one edge under (context, fingerprint) —
    /// D5.6: both fields must be present AND match; results without them
    /// are pre-revision-1 history and never project.
    pub(super) fn live_checks(
        &self,
        txf: &Uuid,
        input: u32,
        context: &str,
        fingerprint: &str,
    ) -> Result<Vec<EdgeCheck>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT entry_id, pinned, checked_against, verdict, time
                 FROM check_results
                 WHERE txf = ?1 AND input_idx = ?2 AND context = ?3
                   AND claims_fingerprint = ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![txf.to_string(), input as i64, context, fingerprint],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (id, pinned, against, verdict, time) = row.map_err(|e| e.to_string())?;
            let verdict = match verdict.as_str() {
                "no-contradiction" => CheckVerdict::NoContradiction,
                "contradiction" => CheckVerdict::Contradiction,
                _ => CheckVerdict::Unknown,
            };
            out.push(EdgeCheck {
                pinned: RevisionId::parse(&pinned)?,
                checked_against: RevisionId::parse(&against)?,
                verdict,
                time,
                id: Uuid::parse_str(&id).map_err(|e| e.to_string())?,
            });
        }
        Ok(out)
    }
}
