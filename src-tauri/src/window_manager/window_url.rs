//! The query string a document window opens on — the URL contract with the
//! frontend router.
//!
//! Purpose: split out of `document_windows.rs`, which had reached the 300-line
//! cap. This is a self-contained concern: nothing here builds a window, and the
//! grammar it produces is read by `WindowContext` on the other side of the
//! webview boundary rather than by anything in this module tree.
//!
//! @coordinates-with document_windows.rs — the only caller
//! @module window_manager/window_url

/// The one place a parameter list becomes a URL (audit 20260907 #485).
///
/// Both builders below wrote this rule out — "no params means `/`, otherwise
/// `/?a&b`" — and two copies of a rule the frontend's router depends on is a
/// rule that can drift to two answers. The ORDER of the parameters stays each
/// builder's own, because the two surfaces genuinely differ.
fn url_from_params(params: Vec<String>) -> String {
    if params.is_empty() {
        "/".to_string()
    } else {
        format!("/?{}", params.join("&"))
    }
}

/// Build window URL with optional query params
pub(super) fn build_window_url(file_path: Option<&str>, workspace_root: Option<&str>) -> String {
    let mut params = Vec::new();

    if let Some(path) = file_path {
        params.push(format!("file={}", urlencoding::encode(path)));
    }

    if let Some(root) = workspace_root {
        params.push(format!("workspaceRoot={}", urlencoding::encode(root)));
    }

    url_from_params(params)
}

/// Build window URL with workspace root and multiple file paths.
pub(super) fn build_window_url_with_files(
    file_paths: &[String],
    workspace_root: Option<&str>,
) -> String {
    let mut params = Vec::new();

    if let Some(root) = workspace_root {
        params.push(format!("workspaceRoot={}", urlencoding::encode(root)));
    }

    if !file_paths.is_empty() {
        let serialized = serde_json::to_string(file_paths).unwrap_or_default();
        params.push(format!("files={}", urlencoding::encode(&serialized)));
    }

    url_from_params(params)
}

#[cfg(test)]
#[path = "window_url.test.rs"]
mod tests;
