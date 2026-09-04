//! The same-document navigation transition (audit 20260903 round 3, #21).
//!
//! `pushState`, `replaceState` and a fragment jump change the page without a
//! load. The KVO observer that sees them (`nav_kvo_macos.rs`) used to read the
//! tab's committed URL, mode, epoch and shared approval through four separate
//! registry locks, and then write the new committed URL through a fifth. A
//! top-level navigation begun by a command thread between those locks REVOKES the
//! committed page (`begin_navigation` clears it) — and the observer's late write
//! put it back, on a tab that was `Navigating` and therefore executable, for a
//! page WebKit was already leaving.
//!
//! Everything the observer decides on is read here in one guard
//! (`same_document_view`), and the transition (`commit_same_document`) re-checks,
//! under its own single guard, that the page it observed is still the page in
//! force: the tab is executable, still holds a committed page, and its active
//! top-level ticket is the one observed. A newer ticket means that navigation's
//! own commit owns the next committed URL, and this callback records nothing.

use super::{AutomationMode, BrowserRegistry};

/// What the same-document observer needs, read under one guard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SameDocumentView {
    pub committed_url: Option<String>,
    pub mode: AutomationMode,
    pub policy_epoch: u64,
    /// The active top-level ticket — what `commit_same_document` must still find.
    pub navigation_id: Option<String>,
    /// Shared posture: is the observed url inside the origin the current
    /// navigation was approved for?
    pub shared_approved: bool,
}

/// Why a same-document commit was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SameDocumentRefusal {
    UnknownTab,
    /// The tab owns no executable page (`Creating`, `Crashed`, `Destroyed`).
    NotExecutable,
    /// A top-level navigation started since the observation: the committed page
    /// is revoked, and that navigation's commit — not this callback — records the
    /// next one.
    Superseded,
    /// Executable, but no load has committed: there is no document to have
    /// navigated within.
    NoCommittedPage,
    /// The generation cannot advance (see `BrowserError::GenerationExhausted`),
    /// so the tab's committed page has been DROPPED — see `commit_same_document`.
    GenerationExhausted,
}

impl BrowserRegistry {
    /// One consistent read of the facts a same-document navigation to `url` is
    /// judged on.
    pub fn same_document_view(&self, tab_id: &str, url: &str) -> Option<SameDocumentView> {
        let entry = self.tabs.get(tab_id)?;
        Some(SameDocumentView {
            committed_url: entry.committed_url.clone(),
            mode: entry.automation_mode,
            policy_epoch: entry.policy_epoch,
            navigation_id: entry
                .active_navigation
                .as_ref()
                .map(|ticket| ticket.id.clone()),
            shared_approved: self.shared_navigation_approved(tab_id, url),
        })
    }

    /// Record `url` as the committed page after a same-document navigation and
    /// bump the generation, so every command stamped for the previous view is
    /// stale (R7a) — provided the page the observer saw is still the page in
    /// force (see the module doc). Returns the new generation.
    ///
    /// **An exhausted generation drops the committed page** rather than
    /// re-recording it. A counter that cannot advance cannot distinguish this view
    /// from the last one, so every stamp made for the view the SPA just replaced
    /// would stay fresh — the hazard R7a exists to close. `commit_navigation`
    /// fails closed the same way (#28); the caller completes it by clearing the
    /// tab's one-shots and attachment, which live outside this lock.
    pub fn commit_same_document(
        &mut self,
        tab_id: &str,
        url: &str,
        expected_navigation_id: Option<&str>,
    ) -> Result<u64, SameDocumentRefusal> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or(SameDocumentRefusal::UnknownTab)?;
        if !entry.state.is_executable() {
            return Err(SameDocumentRefusal::NotExecutable);
        }
        let current_ticket = entry
            .active_navigation
            .as_ref()
            .map(|ticket| ticket.id.as_str());
        if current_ticket != expected_navigation_id {
            return Err(SameDocumentRefusal::Superseded);
        }
        if entry.committed_url.is_none() {
            return Err(SameDocumentRefusal::NoCommittedPage);
        }
        let Some(generation) = entry.generation.checked_add(1) else {
            entry.committed_url = None;
            return Err(SameDocumentRefusal::GenerationExhausted);
        };
        entry.generation = generation;
        entry.committed_url = Some(url.to_string());
        Ok(generation)
    }
}

#[cfg(test)]
#[path = "registry_same_document.test.rs"]
mod tests;
