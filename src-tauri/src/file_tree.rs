//! # File Tree
//!
//! Purpose: Lists directory contents for the sidebar file explorer.
//!
//! Pipeline: Frontend invoke("list_directory_entries") → this module → filesystem readdir
//!
//! Key decisions:
//!   - Hidden file detection is cross-platform: dot-prefix on all OSes,
//!     plus FILE_ATTRIBUTE_HIDDEN/SYSTEM on Windows.
//!   - Errors on individual entries are silently skipped so one bad symlink
//!     doesn't break the entire listing.

use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    #[serde(rename = "isHidden")]
    pub is_hidden: bool,
}

fn is_hidden_by_name(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(windows)]
fn is_hidden_by_metadata(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    let attrs = metadata.file_attributes();
    (attrs & FILE_ATTRIBUTE_HIDDEN != 0) || (attrs & FILE_ATTRIBUTE_SYSTEM != 0)
}

#[cfg(not(windows))]
fn is_hidden_by_metadata(_: &fs::Metadata) -> bool {
    false
}

/// List immediate children of a directory for the file explorer sidebar.
///
/// Returns name, path, directory flag, and hidden flag for each entry.
/// Individual entry errors (e.g., broken symlinks) are silently skipped.
///
/// # Errors
/// Returns `Err` if the directory itself cannot be read.
#[tauri::command]
pub fn list_directory_entries(path: &str) -> Result<Vec<DirectoryEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read dir: {e}"))?;
    let mut results = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();

        let is_directory = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false);

        let is_hidden = entry
            .metadata()
            .map(|metadata| is_hidden_by_metadata(&metadata) || is_hidden_by_name(&name))
            .unwrap_or_else(|_| is_hidden_by_name(&name));

        results.push(DirectoryEntry {
            name,
            path,
            is_directory,
            is_hidden,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn list_directory_entries_marks_dotfiles_hidden() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join(".hidden.md"), "secret").unwrap();
        fs::write(root.join("visible.md"), "hello").unwrap();

        let entries = list_directory_entries(root.to_str().unwrap()).unwrap();

        let hidden = entries.iter().find(|entry| entry.name == ".hidden.md");
        let visible = entries.iter().find(|entry| entry.name == "visible.md");

        assert!(hidden.is_some());
        assert!(visible.is_some());
        assert!(hidden.unwrap().is_hidden);
        assert!(!visible.unwrap().is_hidden);
    }
}
