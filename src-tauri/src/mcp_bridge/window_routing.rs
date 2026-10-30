//! Workspace-aware window routing (F5; design-3.md D4.1). Pure
//! decision: given the request's payload and a snapshot of every window's
//! open workspace and tabs, pick the target window with fail-loud
//! precedence — the window holding an explicit `tabId` (each window's
//! webview holds only its own tabs, so any other window would answer
//! INVALID_TAB or act on the wrong one), then canonical workspace containment
//! (deepest wins; a tie between two windows is an ambiguity error), then
//! focused, then last focused, then main. The last-focused step matters
//! because the user is usually typing in their AI client, so no VMark window
//! holds focus; `main` alone sent such a request to a window the user was
//! not working in (#1612). Workspace scope overrides focus; a workspace request never
//! silently lands on an unrelated window.
//!
//! There is deliberately NO explicit-window pin here. One existed:
//! `resolve_target_window` read `args.windowId` and this module honored it
//! ahead of everything else. No shipped tool has ever sent that field — the
//! wire contract (`server/mcp/src/bridge/operationSchemas.ts`) declares no
//! `windowId` on any operation — so the branch was unreachable by
//! construction, and the ambiguity error below advertised a parameter no
//! client could supply. Explicit window targeting DOES ship, as `windowLabel`
//! on `workspace.new` / `open` / `focus_window`, resolved by the webview
//! handler that receives the request; renaming this branch to read
//! `windowLabel` would have given routing a precedence it never had.

/// One window the bridge could route to.
#[derive(Debug, Clone)]
pub struct WindowCandidate {
    pub label: String,
    /// Canonical open-workspace root, if this window is in workspace mode.
    pub workspace: Option<String>,
    pub focused: bool,
    /// The document window that held focus most recently (Finder's
    /// hot-open history, `FileOpenState::last_focused_document_window`).
    pub last_focused: bool,
    /// `main` or `doc-*` — the document windows requests may target.
    pub is_document: bool,
    /// The tab ids this window published (`mcp_bridge_set_window_tabs`).
    pub tabs: Vec<String>,
}

/// The target for a request's payload: the document window holding its
/// explicit `tabId`, else `pick_target_window` on its scoping path. Tab ids
/// are UUIDs, so one window holds one once every window has republished; two
/// claiming it (a tab moving between windows, seen before its old window
/// republished) is refused rather than routed to the first listed. A tab no
/// window holds (or an empty id) falls through, and the frontend guard
/// answers it.
pub fn pick_target_window_for(
    args: &serde_json::Value,
    candidates: &[WindowCandidate],
) -> Result<String, String> {
    let tab = args
        .get("tabId")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty());
    if let Some(tab) = tab {
        let owners: Vec<&WindowCandidate> = candidates
            .iter()
            .filter(|c| c.is_document && c.tabs.iter().any(|t| t == tab))
            .collect();
        match owners.as_slice() {
            [] => {}
            [only] => return Ok(only.label.clone()),
            _ => {
                return Err(format!(
                    "tab '{tab}' is claimed by {} windows — ambiguous while it moves between windows; retry",
                    owners.len()
                ))
            }
        }
    }
    pick_target_window(scoping_path(args).as_deref(), candidates)
}

/// The request's workspace-scoping path (`workspace_root`, else the
/// `filePath` of `workspace.open`). Canonical/absolute is the caller's
/// responsibility; comparison here is byte-exact on segment boundaries.
pub fn scoping_path(args: &serde_json::Value) -> Option<String> {
    args.get("workspace_root")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("filePath").and_then(|v| v.as_str()))
        .map(str::to_string)
}

/// True when `path` is inside (or equal to) `root` on a segment boundary.
fn contains(root: &str, path: &str) -> bool {
    if path == root {
        return true;
    }
    let with_sep = if root.ends_with('/') {
        root.to_string()
    } else {
        format!("{root}/")
    };
    path.starts_with(&with_sep)
}

/// D4.1 precedence. Returns the target label, or a fail-loud error when
/// the request's workspace is open in more than one window.
pub fn pick_target_window(
    path: Option<&str>,
    candidates: &[WindowCandidate],
) -> Result<String, String> {
    // (1) Workspace containment — deepest root wins; a tie between two
    // windows on the same root is ambiguous (which one?).
    if let Some(p) = path {
        let mut containing: Vec<&WindowCandidate> = candidates
            .iter()
            .filter(|c| c.workspace.as_deref().is_some_and(|ws| contains(ws, p)))
            .collect();
        if !containing.is_empty() {
            // Deepest = longest workspace string (ancestors of one path
            // form a chain, so length totally orders them).
            let deepest = containing
                .iter()
                .map(|c| c.workspace.as_deref().unwrap_or("").len())
                .max()
                .unwrap_or(0);
            containing.retain(|c| c.workspace.as_deref().unwrap_or("").len() == deepest);
            return match containing.as_slice() {
                [only] => Ok(only.label.clone()),
                _ => Err(format!(
                    "path '{p}' is open in {} windows — ambiguous; close one of them so the target is unambiguous",
                    containing.len()
                )),
            };
        }
        // No window owns it: fall through. The frontend path guard will
        // fail loud in whichever window answers.
    }

    // (3) Workspace-less request: focused document window, then the one the
    // user last worked in, then main.
    if let Some(focused) = candidates
        .iter()
        .find(|c| c.focused && c.is_document)
        .or_else(|| candidates.iter().find(|c| c.last_focused && c.is_document))
        .map(|c| c.label.clone())
    {
        return Ok(focused);
    }
    Ok("main".to_string())
}

#[cfg(test)]
#[path = "window_routing.test.rs"]
mod tests;
