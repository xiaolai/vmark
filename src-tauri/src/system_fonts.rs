//! Installed font families, for the font pickers in Settings (#1429).
//!
//! Purpose: VMark's font settings were a CLOSED, curated list — six Latin
//! families, six CJK, sixteen monospace. A user who installs anything else
//! (the report was LXGW WenKai / 霞鹜文楷) could not reach it at all, and the
//! app gave no hint that the list was the limit rather than the whole world.
//! The frontend now also accepts a `custom:<family>` setting; this command is
//! what turns "type the exact family name" into "pick it from the ones you
//! have".
//!
//! Key decisions:
//!   - **macOS enumerates; every other platform answers an empty list, and
//!     that is a supported answer rather than a failure.** The frontend treats
//!     an empty list as "no suggestions" and still accepts a typed family, so
//!     the feature works everywhere and is merely nicer here (AGENTS.md:
//!     macOS is the primary platform, Windows/Linux best-effort). Enumerating
//!     on the other two means DirectWrite COM and fontconfig/pango — code
//!     nothing on this machine can run, so it would ship untested.
//!   - **`NSFontManager` is `MainThreadOnly`**, so the work hops to the main
//!     thread. The command is `async` (never the blocking IPC thread) and the
//!     hop still checks for an existing marker first: `run_on_main_thread`
//!     always ENQUEUES, so a caller already on the main thread would block on
//!     a job that cannot start until it returns.
//!   - **The hop's deadline is safe here in a way it is not for the browser
//!     surface.** This body only READS, so a closure that runs after the
//!     waiter gave up mutates nothing — no `HopState` tri-state is needed.
//!   - **Dot-prefixed families are dropped — a floor, not a fix.** Measured on
//!     macOS 26, AppKit already filters them: 308 families, none beginning
//!     with `.`. The filter stays because the ones it would catch
//!     (`.SF NS Mono`, `.AppleSystemUIFont`) are Apple's hidden internals that
//!     WebKit does not match BY FAMILY NAME at all — which is exactly why the
//!     mono stack reaches SF Mono through `ui-monospace` instead (see
//!     `src/utils/fontStacks.ts`). Offering one would be offering a choice
//!     that silently does nothing.
//!
//! @coordinates-with src/services/fonts/systemFonts.ts — the only caller
//! @coordinates-with src/utils/fontStacks.ts — where a picked family is resolved

use crate::command_error::CommandError;
use tauri::AppHandle;

/// Every installed font family, sorted, or an empty list where VMark does not
/// enumerate them. Never errors just because a platform has no implementation.
#[tauri::command]
pub async fn list_system_font_families(app: AppHandle) -> Result<Vec<String>, CommandError> {
    gather(&app).map(normalize)
}

/// Families in a stable, case-insensitive order with duplicates and Apple's
/// hidden dot-families removed.
///
/// Called by the COMMAND rather than by each platform's `gather`, so the one
/// normalization runs on every platform — including the ones that gather
/// nothing. When it lived inside the macOS branch, `cargo clippy` for
/// x86_64-pc-windows-gnu failed with `function \`normalize\` is never used`,
/// which nothing on a macOS machine can see (`scripts/check-cross-target.sh`).
fn normalize(mut names: Vec<String>) -> Vec<String> {
    names.retain(|name| !name.is_empty() && !name.starts_with('.'));
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    names.dedup();
    names
}

#[cfg(target_os = "macos")]
fn gather(app: &AppHandle) -> Result<Vec<String>, CommandError> {
    use objc2::MainThreadMarker;

    if let Some(mtm) = MainThreadMarker::new() {
        return Ok(families(mtm));
    }

    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        // `run_on_main_thread` guarantees the marker; a failed send means the
        // waiter has already timed out and nothing is listening, which is fine
        // because this closure read and mutated nothing.
        let names = MainThreadMarker::new().map(families).unwrap_or_default();
        let _ = tx.send(names);
    })
    .map_err(|e| CommandError::internal(format!("run_on_main_thread: {e}")))?;

    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| CommandError::internal(format!("font enumeration did not answer: {e}")))
}

#[cfg(target_os = "macos")]
fn families(mtm: objc2::MainThreadMarker) -> Vec<String> {
    objc2_app_kit::NSFontManager::sharedFontManager(mtm)
        .availableFontFamilies()
        .iter()
        .map(|name| name.to_string())
        .collect()
}

/// Windows and Linux: no enumeration, and no error either — the picker falls
/// back to a typed family name, which works on every platform.
#[cfg(not(target_os = "macos"))]
fn gather(_app: &AppHandle) -> Result<Vec<String>, CommandError> {
    Ok(Vec::new())
}

#[cfg(test)]
#[path = "system_fonts.test.rs"]
mod tests;
