//! # Confirm-quit setting, remembered by Rust
//!
//! Purpose: let the confirm-quit gate know the user's choice from the first
//! instant of a launch, not once the webview has mounted and synced it.
//!
//! Key decisions:
//!   - The setting's source of truth is the webview's persisted settings store,
//!     which Rust cannot read. Rust keeps its own one-word copy in the app data
//!     directory, written every time the frontend syncs the setting and read
//!     during setup, before the menu is live. Without it the gate defaulted to
//!     "on" until the first sync, so a Quit right after launch with the setting
//!     off was swallowed as a first press (#1657).
//!   - A missing, unreadable or corrupt copy leaves the default (on): the gate
//!     is the safer state, and the frontend sync corrects it moments later.
//!   - A failed write is logged, never surfaced: the in-memory gate is already
//!     right for this run; only the next launch's head start is lost.
//!
//! @coordinates-with quit.rs — owns the gate this value seeds
//! @coordinates-with hooks/useConfirmQuitSync.ts — the frontend side of the sync
//! @module quit::setting

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use crate::atomic_replace::atomic_replace;

/// File name of the remembered setting inside the app data directory.
const SETTING_FILE: &str = "confirm-quit";

/// Where this run persists the setting (set by `init_confirm_quit`).
static SETTING_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Parse the stored text. Anything but the two words we write is `None`.
pub(super) fn parse(text: &str) -> Option<bool> {
    match text.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Read the remembered value from `path`, if there is a valid one.
pub(super) fn read(path: &Path) -> Option<bool> {
    parse(&std::fs::read_to_string(path).ok()?)
}

/// Remember `enabled` at `path`, creating its directory. Replaced atomically
/// and durably, so a crash never leaves half a word behind.
pub(super) fn remember_at(path: &Path, enabled: bool) -> Result<(), String> {
    if read(path) == Some(enabled) {
        return Ok(());
    }
    let parent = path.parent().ok_or("no parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let word = if enabled { "true" } else { "false" };
    atomic_replace(path, parent, word.as_bytes()).map_err(|e| format!("{e:?}"))
}

/// Seed the gate from the copy in `dir`; a missing or corrupt copy leaves it.
pub(super) fn seed_gate(dir: &Path) {
    if let Some(enabled) = read(&dir.join(SETTING_FILE)) {
        super::CONFIRM_QUIT_ENABLED.store(enabled, Ordering::SeqCst);
    }
}

/// Seed the confirm-quit gate from the copy remembered in `dir`, before the
/// menu is live, so a Quit right after launch honours the stored choice
/// (#1657), and note where to write future values. Called from setup.
pub fn init_confirm_quit(dir: &Path) {
    seed_gate(dir);
    *SETTING_PATH.lock().unwrap_or_else(|p| p.into_inner()) = Some(dir.join(SETTING_FILE));
}

/// Remember `enabled` for the next launch (no-op before `init_confirm_quit`).
pub(super) fn remember(enabled: bool) {
    let path = SETTING_PATH
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    let Some(path) = path else {
        return;
    };
    if let Err(e) = remember_at(&path, enabled) {
        log::warn!("[quit] could not remember the confirm-quit setting: {e}");
    }
}

#[cfg(test)]
#[path = "quit_setting.test.rs"]
mod tests;
