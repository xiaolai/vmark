//! Committed-page authority, lifecycle transitions, and registry queries.

use super::{BrowserError, BrowserRegistry, Entry, Lifecycle};

impl BrowserRegistry {
    pub fn set_committed_url(&mut self, tab_id: &str, url: &str) -> Result<(), BrowserError> {
        let entry = self.live_entry_mut(tab_id)?;
        entry.committed_url = Some(url.to_string());
        Ok(())
    }

    pub fn clear_committed_url(&mut self, tab_id: &str) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        entry.committed_url = None;
        Ok(())
    }

    fn live_entry_mut(&mut self, tab_id: &str) -> Result<&mut Entry, BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry.state.is_terminal() {
            return Err(BrowserError::TerminalTab(tab_id.to_string()));
        }
        Ok(entry)
    }

    pub fn committed_url(&self, tab_id: &str) -> Option<&str> {
        self.tabs
            .get(tab_id)
            .and_then(|e| e.committed_url.as_deref())
    }

    pub fn transition(&mut self, tab_id: &str, to: Lifecycle) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if !entry.state.can_transition_to(to) {
            return Err(BrowserError::InvalidTransition {
                from: entry.state,
                to,
            });
        }
        entry.state = to;
        if !to.is_executable() {
            entry.committed_url = None;
        }
        Ok(())
    }

    pub fn bump_generation(&mut self, tab_id: &str) -> Result<u64, BrowserError> {
        let entry = self.live_entry_mut(tab_id)?;
        entry.generation = entry.generation.saturating_add(1);
        Ok(entry.generation)
    }

    #[allow(dead_code, reason = "observation seam for the generation tests")]
    pub fn generation(&self, tab_id: &str) -> Option<u64> {
        self.tabs.get(tab_id).map(|e| e.generation)
    }

    pub fn state(&self, tab_id: &str) -> Option<Lifecycle> {
        self.tabs.get(tab_id).map(|e| e.state)
    }

    pub fn set_policy_epoch(&mut self, tab_id: &str, epoch: u64) -> Result<(), BrowserError> {
        let entry = self
            .tabs
            .get_mut(tab_id)
            .ok_or_else(|| BrowserError::UnknownTab(tab_id.to_string()))?;
        if entry.state.is_terminal() {
            return Err(BrowserError::TerminalTab(tab_id.to_string()));
        }
        entry.policy_epoch = epoch;
        Ok(())
    }

    pub fn policy_epoch(&self, tab_id: &str) -> Option<u64> {
        self.tabs.get(tab_id).map(|entry| entry.policy_epoch)
    }

    #[allow(dead_code, reason = "consumer is the per-window teardown WI")]
    pub fn window_of(&self, tab_id: &str) -> Option<&str> {
        self.tabs.get(tab_id).map(|e| e.window_label.as_str())
    }

    #[allow(dead_code, reason = "observation seam for the lifecycle tests")]
    pub fn contains(&self, tab_id: &str) -> bool {
        self.tabs.contains_key(tab_id)
    }

    #[allow(dead_code, reason = "observation seam for the lifecycle tests")]
    pub fn is_empty(&self) -> bool {
        self.tabs.is_empty()
    }

    pub fn is_command_fresh(&self, tab_id: &str, generation: u64) -> bool {
        match self.tabs.get(tab_id) {
            Some(e) => e.state.is_executable() && e.generation == generation,
            None => false,
        }
    }

    pub fn remove(&mut self, tab_id: &str) {
        self.tabs.remove(tab_id);
    }

    #[allow(dead_code, reason = "consumer is the per-window teardown WI")]
    pub fn tabs_in_window(&self, window_label: &str) -> Vec<String> {
        self.tabs
            .iter()
            .filter(|(_, e)| e.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect()
    }
}
