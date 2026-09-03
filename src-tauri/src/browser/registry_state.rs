//! Committed-page authority, lifecycle transitions, and registry queries.

use super::{AutomationMode, BrowserError, BrowserRegistry, Entry, Lifecycle};

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
        // A saturated counter would leave every command stamped with u64::MAX
        // fresh forever; refusing is the loud alternative (unreachable in practice).
        entry.generation = entry
            .generation
            .checked_add(1)
            .ok_or_else(|| BrowserError::GenerationExhausted(tab_id.to_string()))?;
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

    /// The window that owns `tab_id` — what routes its events, scopes its standing
    /// grants (audit 20260903 A-03) and decides who may answer its dialogs.
    pub fn window_of(&self, tab_id: &str) -> Option<&str> {
        self.tabs.get(tab_id).map(|e| e.window_label.as_str())
    }

    /// Does `tab_id` belong to `window_label`? Exact, and `false` for an unknown
    /// tab — a dialog for a tab the registry has forgotten has no window entitled
    /// to answer it.
    pub fn tab_belongs_to_window(&self, tab_id: &str, window_label: &str) -> bool {
        self.window_of(tab_id) == Some(window_label)
    }

    /// How many AI-owned tabs are alive: not human, and not in a terminal state
    /// (audit 20260903 X-01 — `browser_ai_create` refuses at `MAX_AI_TABS`).
    pub fn live_ai_tab_count(&self) -> usize {
        self.tabs
            .values()
            .filter(|e| e.automation_mode != AutomationMode::Human && !e.state.is_terminal())
            .count()
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

    pub fn tabs_in_window(&self, window_label: &str) -> Vec<String> {
        self.tabs
            .iter()
            .filter(|(_, e)| e.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect()
    }
}
