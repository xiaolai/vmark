//! Navigation ticket and shared-posture state for the browser registry.

use super::{BrowserError, BrowserRegistry, Lifecycle, NavigationTicket};

/// The registry state a navigation replaces (see `snapshot_navigation`).
#[derive(Debug, Clone)]
pub struct NavigationSnapshot {
    pub state: Lifecycle,
    pub committed_url: Option<String>,
    pub ticket: Option<NavigationTicket>,
    pub shared_origin: Option<String>,
}

impl BrowserRegistry {
    /// Start or supersede a top-level navigation and return its ticket. The
    /// ticket is independent of generation because provisional failures do not
    /// commit and therefore cannot bump generation.
    pub fn begin_navigation(
        &mut self,
        tab_id: &str,
        requested_url: &str,
    ) -> Result<NavigationTicket, BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry.state.is_terminal() {
            return Err(BrowserError::TerminalTab(tab_id.to_string()));
        }
        if !entry.state.can_transition_to(Lifecycle::Navigating) {
            return Err(BrowserError::InvalidTransition {
                from: entry.state,
                to: Lifecycle::Navigating,
            });
        }
        entry.state = Lifecycle::Navigating;
        entry.committed_url = None;
        entry.shared_navigation_origin = None;
        entry.navigation_sequence = entry.navigation_sequence.saturating_add(1);
        let ticket = NavigationTicket {
            id: format!("nav-{}-{}", tab_id, entry.navigation_sequence),
            sequence: entry.navigation_sequence,
            requested_url: requested_url.to_string(),
        };
        entry.active_navigation = Some(ticket.clone());
        Ok(ticket)
    }

    pub fn navigation_ticket(&self, tab_id: &str) -> Option<&NavigationTicket> {
        self.tabs
            .get(tab_id)
            .and_then(|entry| entry.active_navigation.as_ref())
    }

    pub fn clear_navigation(&mut self, tab_id: &str) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        entry.active_navigation = None;
        entry.shared_navigation_origin = None;
        Ok(())
    }

    pub fn shared_navigation_origin(&self, tab_id: &str) -> Option<String> {
        self.tabs
            .get(tab_id)
            .and_then(|entry| entry.shared_navigation_origin.clone())
    }

    pub fn rollback_navigation(
        &mut self,
        tab_id: &str,
        navigation_id: &str,
        state: Lifecycle,
        committed_url: Option<String>,
        previous_ticket: Option<NavigationTicket>,
        previous_shared_origin: Option<String>,
    ) -> Result<bool, BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry
            .active_navigation
            .as_ref()
            .map(|ticket| ticket.id.as_str())
            != Some(navigation_id)
        {
            return Ok(false);
        }
        entry.state = state;
        entry.committed_url = committed_url;
        entry.active_navigation = previous_ticket;
        entry.shared_navigation_origin = previous_shared_origin;
        Ok(true)
    }

    /// Everything `begin_navigation` is about to change, captured so a native
    /// failure can put it back. One definition for the human and the AI navigate
    /// commands — the human path used to snapshot nothing and rolled back nothing.
    pub fn snapshot_navigation(&self, tab_id: &str) -> Result<NavigationSnapshot, BrowserError> {
        let state = self
            .state(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        Ok(NavigationSnapshot {
            state,
            committed_url: self.committed_url(tab_id).map(str::to_owned),
            ticket: self.navigation_ticket(tab_id).cloned(),
            shared_origin: self.shared_navigation_origin(tab_id),
        })
    }

    /// `snapshot_navigation` and `begin_navigation` as ONE step, so the snapshot
    /// is exactly the state this navigation replaced (audit 20260903 round 3, #4).
    /// Taken under separate guards, a navigation begun between them was captured
    /// by neither: a native failure then rolled the tab back PAST it, to a page
    /// and ticket that navigation had already superseded.
    pub fn begin_navigation_with_snapshot(
        &mut self,
        tab_id: &str,
        requested_url: &str,
    ) -> Result<(NavigationTicket, NavigationSnapshot), BrowserError> {
        let snapshot = self.snapshot_navigation(tab_id)?;
        let ticket = self.begin_navigation(tab_id, requested_url)?;
        Ok((ticket, snapshot))
    }

    /// Restore a snapshot taken by `snapshot_navigation` if `navigation_id` is
    /// still the active navigation (a concurrent navigation is left alone).
    pub fn restore_navigation(
        &mut self,
        tab_id: &str,
        navigation_id: &str,
        snapshot: NavigationSnapshot,
    ) -> Result<bool, BrowserError> {
        self.rollback_navigation(
            tab_id,
            navigation_id,
            snapshot.state,
            snapshot.committed_url,
            snapshot.ticket,
            snapshot.shared_origin,
        )
    }

    pub fn set_shared_navigation_approval(
        &mut self,
        tab_id: &str,
        destination_url: &str,
    ) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        entry.shared_navigation_origin =
            crate::browser::origin_guard::canonicalize_origin(destination_url)
                .map(|origin| crate::browser::origin_guard::origin_key(&origin));
        Ok(())
    }

    pub fn shared_navigation_approved(&self, tab_id: &str, committed_url: &str) -> bool {
        let Some(expected) = self
            .tabs
            .get(tab_id)
            .and_then(|entry| entry.shared_navigation_origin.as_deref())
        else {
            return false;
        };
        crate::browser::origin_guard::canonicalize_origin(committed_url)
            .map(|origin| crate::browser::origin_guard::origin_key(&origin))
            .as_deref()
            == Some(expected)
    }

    /// Pin a profile-backed AiSandbox tab to the origin its profile-open grant
    /// approved. Called once, right after the grant is consumed in `browser_ai_create`;
    /// never cleared on navigation, so the confinement outlives redirects (WI-P6.1 H1).
    /// **Set-once**: an already-pinned tab keeps its original origin (a second call is a
    /// no-op), so a later call can never widen or relax an existing confinement.
    pub fn set_profile_origin(
        &mut self,
        tab_id: &str,
        approved_url: &str,
    ) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry.profile_origin.is_some() {
            return Ok(()); // set-once — never relax an existing confinement
        }
        entry.profile_origin = crate::browser::origin_guard::canonicalize_origin(approved_url)
            .map(|origin| crate::browser::origin_guard::origin_key(&origin));
        Ok(())
    }

    /// May the AI READ `committed_url` on this tab? `true` for a profile-less tab
    /// (ordinary unconfined sandbox read). For a profile-backed tab, `true` ONLY when
    /// the committed origin equals the approved profile origin — so a profile-approved
    /// X tab cannot read authenticated Y after a redirect/navigation (WI-P6.1 H1).
    pub fn profile_read_allowed(&self, tab_id: &str, committed_url: &str) -> bool {
        let Some(entry) = self.tabs.get(tab_id) else {
            return false;
        };
        let Some(expected) = entry.profile_origin.as_deref() else {
            return true; // no profile → unconfined sandbox read
        };
        crate::browser::origin_guard::canonicalize_origin(committed_url)
            .map(|origin| crate::browser::origin_guard::origin_key(&origin))
            .as_deref()
            == Some(expected)
    }
}
