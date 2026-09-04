//! Committed-page authority, lifecycle transitions, and registry queries.

use super::{AutomationMode, BrowserError, BrowserRegistry, Entry, Lifecycle};

/// One consistent read of a tab — what `browser_ai_state` reports and what the
/// AI navigate command decides on (audit 20260903 round 3, #5). Read as a whole so
/// no caller has to default a field the entry must have: the per-field reads
/// defaulted a missing generation to 0 and a missing state to "Destroyed", and a
/// fallback there could only ever mask an invariant violation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabStatus {
    pub automation_mode: AutomationMode,
    pub generation: u64,
    pub state: Lifecycle,
    pub policy_epoch: u64,
    /// The active top-level navigation ticket, if one has been begun.
    pub navigation_id: Option<String>,
}

impl BrowserRegistry {
    pub fn tab_status(&self, tab_id: &str) -> Option<TabStatus> {
        self.tabs.get(tab_id).map(|e| TabStatus {
            automation_mode: e.automation_mode,
            generation: e.generation,
            state: e.state,
            policy_epoch: e.policy_epoch,
            navigation_id: e.active_navigation.as_ref().map(|t| t.id.clone()),
        })
    }

    /// Does `tab_id` exist, outside a terminal state, at exactly `generation`?
    /// The precondition for binding tab-scoped authority (a human attachment) to
    /// it, checked under the guard the binding is written under (audit 20260903
    /// round 3, #35): an unknown, destroyed or navigated-away tab gets nothing
    /// bound, so a reused id cannot inherit an attachment written for its
    /// predecessor.
    pub fn tab_alive_at(&self, tab_id: &str, generation: u64) -> bool {
        self.tabs
            .get(tab_id)
            .is_some_and(|e| !e.state.is_terminal() && e.generation == generation)
    }

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

    pub fn generation(&self, tab_id: &str) -> Option<u64> {
        self.tabs.get(tab_id).map(|e| e.generation)
    }

    /// Put a tab AT a generation. The only way to reach the exhausted counter the
    /// fail-closed paths exist for — `bump_generation` moves by one, so u64::MAX
    /// is otherwise unreachable in a test. Arrangement only, hence `cfg(test)`.
    #[cfg(test)]
    pub fn force_generation(&mut self, tab_id: &str, generation: u64) {
        if let Some(entry) = self.tabs.get_mut(tab_id) {
            entry.generation = generation;
        }
    }

    pub fn state(&self, tab_id: &str) -> Option<Lifecycle> {
        self.tabs.get(tab_id).map(|e| e.state)
    }

    /// Re-stamp a tab's posture epoch. Production stamps it at reservation
    /// (`reserve_ai_tab`), so this is an observation seam for the tests that build
    /// AI tabs through `create_with_mode` — compiled only for them (audit round 3,
    /// #29: a production method with no production caller is dead code wearing an
    /// allowance).
    #[cfg(test)]
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

    /// Observation seam for the lifecycle tests; production reads go through the
    /// typed queries above, so this is compiled only for tests (audit round 3, #29).
    #[cfg(test)]
    pub fn contains(&self, tab_id: &str) -> bool {
        self.tabs.contains_key(tab_id)
    }

    /// Observation seam for the lifecycle tests — see `contains`.
    #[cfg(test)]
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
