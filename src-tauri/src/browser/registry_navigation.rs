//! Navigation ticket and shared-posture state for the browser registry.

use super::{BrowserError, BrowserRegistry, Lifecycle, NavigationTicket};

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
        if entry.active_navigation.as_ref().map(|ticket| ticket.id.as_str()) != Some(navigation_id) {
            return Ok(false);
        }
        entry.state = state;
        entry.committed_url = committed_url;
        entry.active_navigation = previous_ticket;
        entry.shared_navigation_origin = previous_shared_origin;
        Ok(true)
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
        entry.shared_navigation_origin = crate::browser::origin_guard::canonicalize_origin(destination_url)
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
