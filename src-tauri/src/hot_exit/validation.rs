//! Structural validation and auto-repair for deserialized session data
//!
//! Validates internal consistency of SessionData after JSON deserialization.
//! Repairs common issues (duplicate tab IDs, invalid active_tab_id) with warnings
//! rather than failing, so sessions are never silently lost.
//!
//! @coordinates-with storage.rs (called after deserialization in read_session)
//! @coordinates-with session.rs (operates on SessionData structs)

use std::collections::{HashMap, HashSet};

use super::session::{SessionData, TabState};

/// Decide whether a later tab sharing a `file_path` with an earlier "kept" tab
/// is a *safe* duplicate that can be dropped without losing user work.
///
/// A duplicate is safe to drop ONLY when it is provably identical and clean:
///   - not dirty and not divergent (no unsaved or conflicting edits), AND
///   - its editor content matches the kept tab's content.
///
/// Otherwise the later tab carries content that would be silently lost if
/// dropped (the exact hot-exit data-loss bug this guards against), so it is
/// preserved.
fn is_safe_duplicate(kept: &TabState, candidate: &TabState) -> bool {
    let doc = &candidate.document;
    !doc.is_dirty && !doc.is_divergent && doc.content == kept.document.content
}

/// Validate and auto-repair a deserialized session.
///
/// Returns a list of warnings describing any repairs that were applied.
/// An empty list means the session was already valid.
pub fn validate_and_repair(session: &mut SessionData) -> Vec<String> {
    let mut warnings = Vec::new();

    for window in &mut session.windows {
        // 1. Remove duplicate tab IDs (keep first occurrence)
        let mut seen_ids = HashSet::new();
        let original_count = window.tabs.len();
        window.tabs.retain(|tab| seen_ids.insert(tab.id.clone()));

        let removed = original_count - window.tabs.len();
        if removed > 0 {
            warnings.push(format!(
                "Window '{}': removed {} duplicate tab(s)",
                window.window_label, removed
            ));
        }

        // 2. Remove duplicate file_path tabs (keep first occurrence) — but ONLY
        //    when the later tab is a safe duplicate (clean + identical content).
        //    tabStore.createTab deduplicates by file_path, so duplicates cause
        //    restoreDocumentState to overwrite the first tab's content silently.
        //    Dropping a later tab that holds dirty, divergent, or otherwise
        //    diverged content would silently lose unsaved work, so such tabs are
        //    preserved instead (the hot-exit data-loss bug this guards).
        //
        //    Compare paths exactly (no case folding). Earlier code lowercased
        //    on non-Linux to handle case-insensitive HFS+/APFS/NTFS, but that
        //    incorrectly merged distinct files on case-sensitive APFS volumes
        //    — a data-availability bug strictly worse than the occasional
        //    duplicate tab that exact comparison may produce on case-
        //    insensitive filesystems. The TS-side validator at
        //    src/services/persistence/hotExit/restoreHelpers.ts now matches.
        //
        //    `kept_by_path` maps a path to the INDEX of its first kept tab in
        //    the rebuilt list so the safe-duplicate check compares against the
        //    actual survivor's content.
        let pre_path_count = window.tabs.len();
        let mut kept_tabs: Vec<TabState> = Vec::with_capacity(pre_path_count);
        let mut kept_by_path: HashMap<String, usize> = HashMap::new();
        let mut path_removed = 0usize;
        for tab in window.tabs.drain(..) {
            match &tab.file_path {
                Some(path) => {
                    if let Some(&kept_index) = kept_by_path.get(path) {
                        if is_safe_duplicate(&kept_tabs[kept_index], &tab) {
                            // Provably identical and clean — safe to drop.
                            path_removed += 1;
                            continue;
                        }
                        // Carries unsaved/divergent content — preserve it so no
                        // work is lost. It keeps its file_path; the restore path
                        // surfaces it as a conflicting tab rather than letting
                        // createTab silently overwrite the first.
                        warnings.push(format!(
                            "Window '{}': kept duplicate-path tab '{}' with unsaved/divergent content",
                            window.window_label, tab.id
                        ));
                        kept_tabs.push(tab);
                    } else {
                        kept_by_path.insert(path.clone(), kept_tabs.len());
                        kept_tabs.push(tab);
                    }
                }
                // untitled tabs are never duplicates
                None => kept_tabs.push(tab),
            }
        }
        window.tabs = kept_tabs;

        if path_removed > 0 {
            warnings.push(format!(
                "Window '{}': removed {} tab(s) with duplicate file_path",
                window.window_label, path_removed
            ));
        }

        // 3. Repair workspace instance metadata that points at removed tabs.
        //    After dropping duplicate/invalid tabs above, workspace_instance
        //    tab_ids / closed_tab_ids / active_tab_id can dangle. Prune the
        //    references so metadata never points at tabs that no longer exist.
        let surviving_ids: HashSet<&str> =
            window.tabs.iter().map(|t| t.id.as_str()).collect();
        for instance in &mut window.workspace_instances {
            let before_tab_ids = instance.tab_ids.len();
            instance.tab_ids.retain(|id| surviving_ids.contains(id.as_str()));
            let before_closed = instance.closed_tab_ids.len();
            instance
                .closed_tab_ids
                .retain(|id| surviving_ids.contains(id.as_str()));
            if let Some(active) = &instance.active_tab_id {
                if !surviving_ids.contains(active.as_str()) {
                    instance.active_tab_id = None;
                }
            }
            if instance.tab_ids.len() != before_tab_ids
                || instance.closed_tab_ids.len() != before_closed
            {
                warnings.push(format!(
                    "Window '{}': pruned removed tab references from workspace instance '{}'",
                    window.window_label, instance.workspace_instance_id
                ));
            }
        }

        // 4. Fix active_tab_id referencing a nonexistent tab
        if let Some(active_id) = &window.active_tab_id {
            let exists = window.tabs.iter().any(|t| t.id == *active_id);
            if !exists {
                let old_id = active_id.clone();
                window.active_tab_id = window.tabs.first().map(|t| t.id.clone());
                warnings.push(format!(
                    "Window '{}': active_tab_id '{}' not found in tabs, reset to {:?}",
                    window.window_label,
                    old_id,
                    window.active_tab_id
                ));
            }
        }

        // 6. Warn about empty windows (no tabs)
        if window.tabs.is_empty() {
            warnings.push(format!(
                "Window '{}': contains no tabs",
                window.window_label
            ));
        }
    }

    warnings
}

#[cfg(test)]
#[path = "validation.test.rs"]
mod tests;
