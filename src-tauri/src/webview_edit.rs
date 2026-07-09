//! Trigger native webview edit actions (cut / copy / paste / select-all).
//!
//! Purpose: the app's Edit menu uses `PredefinedMenuItem` roles, which
//! dispatch `cut:` / `copy:` / `paste:` / `selectAll:` down the responder
//! chain to the focused WKWebView — the only path that gives JS-initiated
//! paste full clipboard fidelity (HTML, images) through the normal webview
//! paste event. The custom editor context menu invokes this command to
//! reuse exactly that path instead of forking the paste pipeline.
//!
//! Focus contract: the frontend must return focus to the editor before
//! invoking (the first responder receives the action). See
//! `dev-docs/plans/20260709-editor-context-menu.md` ADR-3.
//!
//! Non-macOS: returns an error; the frontend falls back to
//! `document.execCommand` / clipboard-manager reads (best-effort per the
//! cross-platform policy).

#[cfg(target_os = "macos")]
use tauri::Manager;

/// The four edit actions the command accepts. Anything else is rejected
/// at the boundary (zero trust: the string arrives from the webview).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EditAction {
    Cut,
    Copy,
    Paste,
    SelectAll,
}

impl EditAction {
    /// Exact-match parser — case variants and padding are rejected so a
    /// typo in the frontend fails loud instead of silently no-opping.
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "cut" => Some(Self::Cut),
            "copy" => Some(Self::Copy),
            "paste" => Some(Self::Paste),
            "selectAll" => Some(Self::SelectAll),
            _ => None,
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn selector(self) -> objc2::runtime::Sel {
        use objc2::sel;
        match self {
            Self::Cut => sel!(cut:),
            Self::Copy => sel!(copy:),
            Self::Paste => sel!(paste:),
            Self::SelectAll => sel!(selectAll:),
        }
    }
}

/// Send a native edit action down the responder chain (macOS), exactly as
/// the Edit menu's predefined items do. Errors on unknown actions, when no
/// responder handles the selector (so the frontend engages its fallback
/// instead of silently no-opping), and on platforms without a responder
/// chain.
///
/// Security: the responder chain targets the KEY window's first responder,
/// not the invoking webview — so a background window could otherwise
/// select-all/copy (exfiltrate) or paste into another window's editor.
/// The focus gate runs ON THE MAIN THREAD, atomically with the send, so
/// key-window changes between check and dispatch cannot bypass it.
#[tauri::command]
pub async fn trigger_webview_edit(window: tauri::Window, action: String) -> Result<(), String> {
    let parsed =
        EditAction::parse(&action).ok_or_else(|| format!("Unknown edit action: {action:?}"))?;
    dispatch(window, parsed).await
}

#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SendOutcome {
    Handled(bool),
    NotFocused,
}

/// Pure mapping from a main-thread send outcome to the command result —
/// split from `dispatch` so every branch is unit-testable without an
/// event loop.
#[cfg(target_os = "macos")]
pub(crate) fn outcome_to_result(outcome: SendOutcome) -> Result<(), String> {
    match outcome {
        SendOutcome::Handled(true) => Ok(()),
        SendOutcome::Handled(false) => Err("No responder handled the edit action".into()),
        SendOutcome::NotFocused => {
            Err("Edit actions require the invoking window to be focused".into())
        }
    }
}

#[cfg(target_os = "macos")]
async fn dispatch(window: tauri::Window, action: EditAction) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<SendOutcome>();
    let app = window.app_handle().clone();
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        // Focus gate, atomic with the send: the invoking window must be
        // the key window at the moment the action fires.
        if !window.is_focused().unwrap_or(false) {
            let _ = tx.send(SendOutcome::NotFocused);
            return;
        }
        // run_on_main_thread guarantees the marker; avoid unwrap to keep
        // the closure panic-free inside the event loop.
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(SendOutcome::Handled(false));
            return;
        };
        let ns_app = NSApplication::sharedApplication(mtm);
        // Target `None` = first responder of the key window — which the
        // gate above just proved is the invoking window.
        let handled = unsafe { ns_app.sendAction_to_from(action.selector(), None, None) };
        let _ = tx.send(SendOutcome::Handled(handled));
    })
    .map_err(|e| format!("Failed to reach main thread: {e}"))?;

    // The command runs on the async runtime; park the wait on a blocking
    // thread so a busy main loop can't stall other tasks.
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(2))
    })
    .await
    .map_err(|e| format!("Responder wait failed: {e}"))?
    .map_err(|_| "Timed out waiting for the responder chain".to_string())?;

    outcome_to_result(outcome)
}

#[cfg(not(target_os = "macos"))]
async fn dispatch(_window: tauri::Window, _action: EditAction) -> Result<(), String> {
    Err("Native edit actions are macOS-only; use the frontend fallback".into())
}

#[cfg(test)]
#[path = "webview_edit.test.rs"]
mod tests;
