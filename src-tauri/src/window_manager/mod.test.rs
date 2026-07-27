//! Tests for `mod.rs` (included via `#[path]`).
//!
//! `mod.rs` declares rather than implements, so there is no behavior of its
//! own to exercise. What it *does* own is a contract its header states
//! explicitly: the glob re-exports are what keep `crate::window_manager::…`
//! paths — including the ones `lib.rs`'s `generate_handler!` names —
//! resolving after the module was decomposed into submodules.
//!
//! That contract has failed silently before: `.claude/rules/60-ai-governance.md`
//! records paths being moved while the thing depending on them kept compiling
//! against a stale location. These tests make a broken facade a compile error
//! here instead of a mystery at the call site.

use super::*;

/// Every `#[tauri::command]` in this module that `lib.rs` registers must be
/// nameable as `crate::window_manager::<name>`. Taking a function pointer is
/// what forces that resolution — if a submodule stops being re-exported, or a
/// command is renamed without updating `generate_handler!`, this stops
/// compiling.
#[test]
fn registered_commands_resolve_through_the_facade() {
    let _open_settings: fn(tauri::AppHandle, Option<String>) -> Result<String, String> =
        open_settings_window;
    let _set_theme: fn(tauri::AppHandle, bool) -> Result<(), String> = set_native_theme;
}

/// The window builders call these unqualified through the facade rather than
/// reaching into `native_theme::`, so the re-export has to carry them too.
#[test]
fn theme_helpers_resolve_through_the_facade() {
    let _current: fn() -> tauri::Theme = current_theme;
    let _remember: fn(bool) = remember;
    let _prefers: fn() -> bool = prefers_dark;
}

/// Guards against the facade re-exporting two different things under one
/// name: `current_theme()` must agree with `prefers_dark()`, since the
/// builders read the former and `set_native_theme` writes the latter.
#[test]
fn facade_theme_view_is_self_consistent() {
    let previous = prefers_dark();

    remember(true);
    assert_eq!(current_theme(), tauri::Theme::Dark);
    assert!(prefers_dark());

    remember(false);
    assert_eq!(current_theme(), tauri::Theme::Light);
    assert!(!prefers_dark());

    remember(previous);
}
