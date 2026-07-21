//! Path validation for the `open_workspace` MCP tool.
//!
//! Opening a folder as a workspace GRANTS the AI a new file tree, so — unlike a
//! file inside an already-consented root — it can't use the bridge path guard
//! (Codex F-11) and is gated by user approval instead. This validates the
//! target in Rust (not a webview `stat`), keeping raw fs out of the MCP bridge
//! surface, and canonicalizes so the granted tree and the approval one-shot
//! bind to the REAL target rather than a symlink name (Codex F-06).

/// Canonicalize `path` (resolving symlinks) and require it be a directory,
/// returning the canonical path for the approval one-shot binding.
#[tauri::command]
pub fn validate_workspace_dir(path: &str) -> Result<String, String> {
    let canonical = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("invalid workspace folder '{path}': {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("'{path}' is not a directory"));
    }
    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_nonexistent_path() {
        assert!(validate_workspace_dir("/no/such/dir/xyzzy").is_err());
    }

    #[test]
    fn rejects_a_file_and_accepts_a_directory() {
        // The temp dir is a real directory; its canonical form is returned.
        let dir = std::env::temp_dir();
        let ok = validate_workspace_dir(dir.to_string_lossy().as_ref());
        assert!(ok.is_ok());

        // A file inside it is rejected.
        let file = dir.join("vmark-ws-validate-test.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_workspace_dir(file.to_string_lossy().as_ref()).is_err());
        let _ = std::fs::remove_file(&file);
    }
}
