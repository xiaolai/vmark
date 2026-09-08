//! # File Tree — hidden-entry detection
//!
//! Purpose: decides whether a directory entry is hidden, for the file
//! explorer's one-call tree listing (`file_tree_walk.rs`, #1357).
//!
//! History: this module was the per-directory `list_directory_entries` IPC
//! (one invoke per expanded folder, serially awaited). #1357 replaced that
//! with the single `list_directory_tree` call and the command stayed
//! registered with zero callers until WI-FL3.2 deleted it. The hidden-detection
//! rule it carried was the only part still load-bearing, so that is what
//! remains.
//!
//! Key decisions:
//!   - Hidden detection is cross-platform: dot-prefix on all OSes, plus
//!     FILE_ATTRIBUTE_HIDDEN/SYSTEM on Windows — and the Windows stat happens
//!     only when the cheap name check did not already decide.

use std::fs;

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

/// Cross-platform hidden check: dot-prefix everywhere, plus the
/// FILE_ATTRIBUTE_HIDDEN/SYSTEM attributes on Windows (stat only when the
/// cheap name check didn't already decide).
pub(crate) fn compute_is_hidden(name: &str, entry: &fs::DirEntry) -> bool {
    if is_hidden_by_name(name) {
        return true;
    }
    #[cfg(windows)]
    {
        if let Ok(metadata) = entry.metadata() {
            return is_hidden_by_metadata(&metadata);
        }
    }
    #[cfg(not(windows))]
    let _ = entry; // no metadata needed off Windows
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    fn entry_named(root: &Path, name: &str) -> fs::DirEntry {
        fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap())
            .find(|e| e.file_name() == name)
            .expect("entry exists")
    }

    #[test]
    fn dot_prefixed_names_are_hidden_everywhere() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".hidden.md"), "secret").unwrap();
        fs::write(dir.path().join("visible.md"), "hello").unwrap();
        assert!(compute_is_hidden(
            ".hidden.md",
            &entry_named(dir.path(), ".hidden.md")
        ));
        assert!(!compute_is_hidden(
            "visible.md",
            &entry_named(dir.path(), "visible.md")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_hidden_attribute_marks_an_entry_hidden() {
        let dir = tempdir().unwrap();
        let hidden = dir.path().join("attr-hidden.md");
        fs::write(&hidden, "hidden by attribute").unwrap();
        fs::write(dir.path().join("plain.md"), "visible").unwrap();

        // Set FILE_ATTRIBUTE_HIDDEN via attrib (no direct std API).
        let status = std::process::Command::new("attrib")
            .arg("+h")
            .arg(&hidden)
            .status()
            .expect("attrib must be available on Windows");
        assert!(status.success());

        assert!(
            compute_is_hidden("attr-hidden.md", &entry_named(dir.path(), "attr-hidden.md")),
            "FILE_ATTRIBUTE_HIDDEN must mark hidden"
        );
        assert!(!compute_is_hidden(
            "plain.md",
            &entry_named(dir.path(), "plain.md")
        ));
    }
}
