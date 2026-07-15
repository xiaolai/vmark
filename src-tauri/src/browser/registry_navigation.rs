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
}
