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

/// Every `#[tauri::command]` in this module that `lib.rs` registers, plus the
/// helpers the window builders call unqualified, must be nameable as
/// `crate::window_manager::<name>`. Importing them is what asserts that: if a
/// submodule stops being re-exported, or a command is renamed without updating
/// `generate_handler!`, this module stops compiling.
///
/// Deliberately `use` rather than function pointers. Binding a pointer to a
/// command emits a runtime symbol reference, which drags WebView2 loader
/// entry points into the lib test binary and makes it fail to start on
/// Windows with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) — the same class
/// `Cargo.toml` already documents for `tauri::test`. A `use` binds a name at
/// compile time and emits nothing, so the contract is still checked, and it is
/// checked on every platform rather than being cfg'd off on the one where it
/// broke.
#[allow(unused_imports)]
mod facade_exports {
    use super::{current_theme, open_settings_window, prefers_dark, remember, set_native_theme};
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
