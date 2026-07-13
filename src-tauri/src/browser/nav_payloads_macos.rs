//! Event payloads emitted by the embedded browser's nav/UI delegate (WI-1.7 /
//! WI-1.8). Split from nav_delegate_macos.rs to keep it under the file-size
//! limit; a `#[path]` submodule of `nav_delegate`.
//!
//! These are the wire contract with the frontend (`useBrowserNavEvents.ts`) —
//! the `tabId` rename is what the TS side reads, so it is not cosmetic.

/// `browser://navigated` — a navigation COMMITTED (didCommitNavigation).
#[derive(serde::Serialize, Clone)]
pub struct NavPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub url: String,
    /// The navigation generation this commit produced (WI-2.1). The frontend
    /// stamps driver operations with it, so an operation authorized against this
    /// page is rejected by the driver once the page navigates away.
    pub generation: u64,
}

/// `browser://loaded` — the load FINISHED cleanly (didFinishNavigation).
#[derive(serde::Serialize, Clone)]
pub struct LoadedPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub url: String,
    pub title: String,
}

/// `browser://load-failed` — the load failed, provisionally or after commit.
#[derive(serde::Serialize, Clone)]
pub struct FailedPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub message: String,
}

/// `browser://crashed` — the web content process died (WI-1.8).
#[derive(serde::Serialize, Clone)]
pub struct CrashPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    /// "auto-reload" only if a reload ACTUALLY started; otherwise "manual".
    pub action: &'static str,
}

/// `browser://popup` — a blocked `window.open` / `target=_blank` target.
#[derive(serde::Serialize, Clone)]
pub struct PopupPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub url: String,
}

/// `browser://dialog` — a page `alert()` or `confirm()` needs the user (WI-1.7).
#[derive(serde::Serialize, Clone)]
pub struct DialogPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    /// "alert" (informational, no response) or "confirm" (needs an OK/Cancel answer).
    pub kind: &'static str,
    pub message: String,
    /// Present for interactive kinds — the id to pass back to `browser_dialog_respond`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
}
