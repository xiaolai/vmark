//! Workspace-aware window routing (WI-3.5 F5; design-3.md D4.1). Pure
//! decision: given the request's scoping path and a snapshot of every
//! window's open workspace, pick the target window with fail-loud
//! precedence — canonical workspace containment (deepest wins; a tie
//! between two windows is an ambiguity error), then focused/main for
//! workspace-less requests. Workspace scope overrides focus; a workspace
//! request never silently lands on an unrelated window.
//!
//! There is deliberately NO explicit-window pin here (WI-15). One existed:
//! `resolve_target_window` read `args.windowId` and this module honored it
//! ahead of everything else. No shipped tool has ever sent that field — the
//! wire contract (`server/mcp/src/bridge/operationSchemas.ts`) declares no
//! `windowId` on any of the 34 operations — so the branch was unreachable by
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
    /// `main` or `doc-*` — the document windows requests may target.
    pub is_document: bool,
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

    // (3) Workspace-less request: focused document window, then main.
    if let Some(focused) = candidates
        .iter()
        .find(|c| c.focused && c.is_document)
        .map(|c| c.label.clone())
    {
        return Ok(focused);
    }
    Ok("main".to_string())
}

#[cfg(test)]
#[path = "window_routing.test.rs"]
mod tests;
