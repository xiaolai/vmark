//! Declared budgets for what the writer retains in memory outside the
//! journal: the degraded queue of failed captures and the table of window
//! base roots. Both grow with what windows send, so both are bounded here
//! and a request past a budget is refused loudly instead of growing the
//! process without limit.
//!
//! Key decisions:
//!   - A queued terminal record's slot is reserved: a prepare is refused
//!     while queued records plus open reservations fill the entry budget,
//!     so every reservation's terminal record fits. A reservation whose
//!     terminal record is already queued counts once, not twice. Captures
//!     (observations, including a prepare's baseline) are refused past the
//!     same occupancy or past the byte budget (counting every queued
//!     record's bytes).
//!   - A terminal record's text is unknown at prepare, so its bytes are
//!     checked when it would be queued: a commit whose text does not fit
//!     is refused with the transaction still open, and its caller ends it
//!     `uncommitted`, which holds no text. Text-free terminal records
//!     (`aborted`, `uncommitted`, `discarded`) always fit.
//!   - The queue budget is global, not per document: it is a memory bound.
//!     A capture past it is `JOURNAL_DEGRADED` with nothing queued; the
//!     window reports "history not recorded" for that save.
//!   - Released window names are remembered (as many as the window
//!     budget, oldest forgotten first) so a capture that answers after its
//!     window closed does not register it again. Windows name a new
//!     incarnation (`<window>/<tab>@<nonce>`) per document, so a released
//!     name is never legitimately reused.
//!   - A window name the base table has never seen is not registered once
//!     the table is full (an existing name is still replaced). The pin it
//!     would have held is logged as lost, and the name is remembered as
//!     unpinned so the collector defers until that window closes: no text
//!     is lost with it. Past the window budget again, only the app window
//!     label is remembered, cleared when that app window is destroyed.
//!
//! @module agent_journal/writer_budget

use crate::agent_journal::errors::TxnError;
use crate::agent_journal::writer::Inner;
#[cfg(test)]
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_degraded::Queued;

/// Retention limits of one writer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionBudget {
    /// Most captures queued for the drainer, over every document.
    pub degraded_entries: usize,
    /// Most text bytes those queued captures may hold.
    pub degraded_bytes: usize,
    /// Most window names with a registered base root.
    pub window_bases: usize,
}

impl Default for RetentionBudget {
    fn default() -> Self {
        Self {
            degraded_entries: 64,
            degraded_bytes: 64 << 20,
            window_bases: 1024,
        }
    }
}

/// The app window a base-root name belongs to: `<label>/<tab>@<nonce>`.
pub(crate) fn window_label(window: &str) -> &str {
    window.split_once('/').map_or(window, |(label, _)| label)
}

fn text_bytes(q: &Queued) -> usize {
    q.blobs.iter().map(|(_, t)| t.len()).sum()
}

impl Inner {
    /// Every queued record (captures and terminal records) and the bytes
    /// they hold, plus one entry per open reservation whose terminal record
    /// is not queued yet: a queued terminal record keeps its reservation
    /// until it drains, and the two are one slot.
    fn occupancy(&self) -> (usize, usize) {
        let (queued, bytes) = self
            .degraded
            .values()
            .flatten()
            .fold((0usize, 0usize), |(n, b), q| (n + 1, b + text_bytes(q)));
        let pending = self
            .reservations
            .iter()
            .filter(|(doc, r)| {
                !self
                    .degraded
                    .get(doc)
                    .is_some_and(|q| q.iter().any(|q| q.releases && q.txn == r.txn))
            })
            .count();
        (queued + pending, bytes)
    }

    /// Refuse queueing a terminal record whose text would take the queue
    /// past the byte budget. Its slot was reserved at prepare; its text was
    /// unknown then, so only the bytes are checked here.
    pub(crate) fn admit_queued_terminal(&self, entry: &Queued) -> Result<(), TxnError> {
        let (_, bytes) = self.occupancy();
        if bytes + text_bytes(entry) > self.budget.degraded_bytes {
            log::error!(
                "agent journal: degraded queue holds {bytes} bytes; a terminal record's text does not fit and the write stays open"
            );
            return Err(TxnError::JournalDegraded);
        }
        Ok(())
    }

    /// Refuse queueing `entry` (a capture) past the degraded budget.
    pub(crate) fn admit_queued_capture(&self, entry: &Queued) -> Result<(), TxnError> {
        let (count, bytes) = self.occupancy();
        let budget = self.budget;
        if count >= budget.degraded_entries || bytes + text_bytes(entry) > budget.degraded_bytes {
            log::error!(
                "agent journal: degraded queue is full ({count} entries reserved or queued, {bytes} bytes); a save is not recorded"
            );
            return Err(TxnError::JournalDegraded);
        }
        Ok(())
    }

    /// Refuse a new reservation unless the degraded queue could still hold
    /// the terminal record every open reservation may leave behind. Called
    /// under the writer lock by every path that reserves.
    pub(crate) fn admit_reservation(&self) -> Result<(), TxnError> {
        let (count, _) = self.occupancy();
        if count >= self.budget.degraded_entries {
            log::error!(
                "agent journal: {count} queued records and open writes fill the degraded budget; a write is refused"
            );
            return Err(TxnError::JournalDegraded);
        }
        Ok(())
    }

    /// Whether `window` may hold a base root: never once released, by name
    /// or by its destroyed app window's label (a late capture must not bring
    /// a closed window back), and within budget. A live window refused for
    /// budget is remembered as unpinned.
    pub(crate) fn admits_window(&mut self, window: &str) -> bool {
        let label = window_label(window);
        if self.released.iter().any(|r| r == window || r == label) {
            log::warn!("agent journal: a capture for a released window does not register its base");
            return false;
        }
        let admitted = self.window_bases.contains_key(window)
            || self.window_bases.len() < self.budget.window_bases;
        if !admitted {
            log::error!(
                "agent journal: {} window bases registered; a new window's base is not pinned",
                self.window_bases.len()
            );
            if self.unpinned.len() < self.budget.window_bases {
                self.unpinned.insert(window.to_owned());
            } else if self.unpinned_labels.contains(label)
                || self.unpinned_labels.len() < self.budget.window_bases
            {
                self.unpinned_labels.insert(label.to_owned());
            } else {
                self.unpinned_overflow = true;
            }
        } else {
            self.unpinned.remove(window);
        }
        admitted
    }

    /// Whether a live window's base may be unpinned (see `admits_window`);
    /// the collector defers while it is.
    pub(crate) fn unpinned_windows(&self) -> bool {
        self.unpinned_overflow || !self.unpinned.is_empty() || !self.unpinned_labels.is_empty()
    }
}

impl Inner {
    /// Remember `window` as released, within the window budget.
    pub(crate) fn remember_released(&mut self, window: &str) {
        if self.released.iter().any(|r| r == window) {
            return;
        }
        if self.released.len() >= self.budget.window_bases {
            self.released.pop_front();
        }
        self.released.push_back(window.to_owned());
    }
}

#[cfg(test)]
impl Writer {
    /// Replace the retention budget (tests use small ones).
    pub fn set_retention_budget(&self, budget: RetentionBudget) {
        self.lock().budget = budget;
    }
}

#[cfg(test)]
#[path = "writer_budget.test.rs"]
mod tests;
