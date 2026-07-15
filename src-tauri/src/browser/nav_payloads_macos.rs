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
    #[serde(rename = "navigationId")]
    pub navigation_id: String,
    /// WKWebView's back/forward-list state at this event (WI-S1.6). The omnibox's
    /// back/forward controls derive their disabled state from these — without them
    /// they ship as always-enabled no-ops.
    #[serde(rename = "canGoBack")]
    pub can_go_back: bool,
    #[serde(rename = "canGoForward")]
    pub can_go_forward: bool,
    /// This navigation followed a server redirect (WI-S2.2). History folds a redirect
    /// chain into one entry — the user went to one place, even though every hop commits.
    pub redirected: bool,
}

/// `browser://loaded` — the load FINISHED cleanly (didFinishNavigation).
#[derive(serde::Serialize, Clone)]
pub struct LoadedPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub url: String,
    pub title: String,
    /// The committed generation of the page that finished. A late `loaded` for a page the
    /// tab has already left carries an older generation, and the frontend store drops a
    /// patch whose generation is stale — so this closes the same out-of-order race the
    /// `navigated` event's generation does. (Audit, Medium.)
    pub generation: u64,
    #[serde(rename = "navigationId")]
    pub navigation_id: String,
    /// See `NavPayload` — history can change on commit OR finish, so both carry it.
    #[serde(rename = "canGoBack")]
    pub can_go_back: bool,
    #[serde(rename = "canGoForward")]
    pub can_go_forward: bool,
}

/// `browser://load-failed` — the load failed, provisionally or after commit.
#[derive(serde::Serialize, Clone)]
pub struct FailedPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub message: String,
    #[serde(rename = "navigationId")]
    pub navigation_id: String,
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

#[cfg(test)]
#[path = "nav_payloads.test.rs"]
mod tests;
