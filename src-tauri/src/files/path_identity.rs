//! Path identity: the file identity behind a path, and the path-text
//! cleanup both identity consumers share.
//!
//! Purpose: two consumers ask when two paths name one file, and they need
//! different answers. The agent journal keys a document by the directory
//! entry's own spelling (`files/entry_spelling.rs`): a false distinction
//! there splits one history, which is recoverable; a false merge hands one
//! file another's history, which is not. The save command's per-target
//! write lock (`files/write/target_lock.rs`) folds broadly instead: a false
//! merge there only serializes two writes, while a false distinction would
//! let two writes to one file overlap. This module holds what both share.
//!
//! Key decisions:
//!   - `path_text` never folds case or normalizes Unicode. On Windows it
//!     uses `\`, with the `\\?\` and `\\?\UNC\` verbatim prefixes removed
//!     (`\\?\UNC\server\share` becomes `\\server\share`, never a relative
//!     path); everywhere it collapses repeated and trailing separators.
//!   - File identity is (device, inode) on Unix and (volume serial, file
//!     index) on Windows. Hard links share it, so it is supporting evidence
//!     (a rename, finding a leaf's stored name), never a document's key.
//!
//! @coordinates-with files/entry_spelling.rs — the journal's entry spelling
//! @coordinates-with files/write/target_lock.rs — the write lock's folding
//! @module files/path_identity

use std::path::Path;

use serde::{Deserialize, Serialize};

/// A file's identity on its volume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FileId {
    pub volume: u64,
    pub index: u64,
}

/// A path's text with separators cleaned up (`windows`: backslashes and
/// no verbatim prefix). Pure; case and Unicode form are kept exactly.
pub fn path_text(raw: &str, windows: bool) -> String {
    let mut text = raw.to_owned();
    let sep = if windows {
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            text = format!(r"\\{rest}");
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            text = rest.to_owned();
        }
        text = text.replace('/', "\\");
        '\\'
    } else {
        '/'
    };
    // A UNC path keeps its leading pair; every other run of separators is one.
    let unc = windows && text.starts_with(r"\\");
    let mut out = String::with_capacity(text.len());
    if unc {
        out.push_str(r"\\");
    }
    for ch in text.chars().skip(if unc { 2 } else { 0 }) {
        if ch == sep && out.ends_with(sep) && !(unc && out.len() == 2) {
            continue;
        }
        out.push(ch);
    }
    let root = out.len() == 1 || (windows && out.len() == 3 && out.ends_with(":\\"));
    if out.ends_with(sep) && !root && !(unc && out.len() == 2) {
        out.pop();
    }
    out
}

/// The identity of the file `path` resolves to, or `None` when it does not
/// exist or the platform cannot say.
#[cfg(unix)]
pub fn file_id(path: &Path) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    Some(FileId {
        volume: meta.dev(),
        index: meta.ino(),
    })
}

#[cfg(windows)]
pub fn file_id(path: &Path) -> Option<FileId> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };
    // Backup semantics so a directory opens too; no access rights are needed
    // to read its identity.
    let file = std::fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0)
        .open(path)
        .ok()?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the handle is open for the duration of the call and `info` is a
    // valid, writable out-parameter.
    unsafe { GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info) }.ok()?;
    Some(FileId {
        volume: u64::from(info.dwVolumeSerialNumber),
        index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}

#[cfg(not(any(unix, windows)))]
pub fn file_id(_path: &Path) -> Option<FileId> {
    None
}

#[cfg(test)]
#[path = "path_identity.test.rs"]
mod tests;
