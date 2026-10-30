//! The list of workspace roots the user chose, and how it is spelled on disk.
//!
//! Purpose: pure data for WI-LX1.1 — no Tauri, no filesystem — so what the list
//! admits, how a candidate is matched against it, and what a file must look
//! like to be believed are all testable without an app.
//!
//! Key decisions:
//!   - Every entry is a canonical absolute path, newest first. Matching is
//!     COMPONENT-wise (`Path::starts_with`), so `/work/proj-evil` is not inside
//!     `/work/proj`, and an ancestor of a listed root is never covered.
//!   - A file this build cannot interpret grants NOTHING. A half-read list that
//!     is then trusted is worse than an empty one: the cost of empty is one
//!     folder-picker confirmation.
//!   - The file is a top-level JSON ARRAY led by [`FORMAT_MARKER`]. The
//!     webview is not granted `store:allow-load` (it reaches only the store
//!     `app_plugins.rs` opens), and a store plugin ever does write only a JSON
//!     OBJECT (its cache, through `serde_json::to_vec_pretty`), so nothing it
//!     writes parses as a list even if that grant came back.
//!   - Bounded at [`MAX_ROOTS`], oldest dropped, so a long-lived install does
//!     not re-grant every folder it was ever shown. [`MAX_FILE_BYTES`] bounds
//!     the PARSE: `MAX_ROOTS` caps what is kept only after serde has built
//!     the whole array, so a file larger than any list this build writes is
//!     refused before it is read into memory.
//!
//! @coordinates-with workspace/grants/mod.rs — owns the state and the file
//! @module workspace/grants/registry

use std::path::Path;

/// Most roots the list keeps. Far above the recent-workspaces menu, so a root
/// the user can still reach from Open Recent is not evicted before it.
pub(crate) const MAX_ROOTS: usize = 128;

/// Largest file [`GrantList::parse`] reads. [`MAX_ROOTS`] roots of 8 KiB each
/// (twice Linux's `PATH_MAX`) fit; a real list is a few kilobytes.
pub(crate) const MAX_FILE_BYTES: usize = 1024 * 1024;

/// First element of the on-disk array, naming the format and its version.
/// Change it, and old builds refuse the new file (no grants) rather than
/// misreading it.
pub(crate) const FORMAT_MARKER: &str = "vmark-workspace-grants/1";

/// Roots the user chose, newest first.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct GrantList {
    roots: Vec<String>,
}

impl GrantList {
    /// Read a list from the file's bytes, refusing anything it cannot vouch for:
    /// the file must be at most [`MAX_FILE_BYTES`] and an array led by
    /// [`FORMAT_MARKER`]; entries after it that are not absolute path strings
    /// are dropped.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!(
                "grant list is {} bytes, over the {MAX_FILE_BYTES}-byte limit",
                bytes.len()
            ));
        }
        let disk: Vec<serde_json::Value> =
            serde_json::from_slice(bytes).map_err(|e| format!("unreadable grant list: {e}"))?;
        let mut entries = disk.into_iter();
        if entries.next().as_ref().and_then(serde_json::Value::as_str) != Some(FORMAT_MARKER) {
            return Err(format!("grant list does not start with {FORMAT_MARKER:?}"));
        }
        let mut list = GrantList::default();
        for entry in entries {
            if list.roots.len() == MAX_ROOTS {
                break;
            }
            if let Some(root) = entry.as_str() {
                if is_absolute(root) && !list.roots.iter().any(|r| r == root) {
                    list.roots.push(root.to_owned());
                }
            }
        }
        Ok(list)
    }

    /// The bytes [`GrantList::parse`] reads back.
    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        let mut disk: Vec<&str> = Vec::with_capacity(self.roots.len() + 1);
        disk.push(FORMAT_MARKER);
        disk.extend(self.roots.iter().map(String::as_str));
        // A list of strings cannot fail to serialize.
        serde_json::to_vec_pretty(&disk).unwrap_or_default()
    }

    /// Put `root` first. Returns whether the list changed, i.e. whether there is
    /// anything to persist. A relative or empty root is refused.
    pub(crate) fn record(&mut self, root: &str) -> bool {
        if !is_absolute(root) {
            return false;
        }
        if self.roots.first().map(String::as_str) == Some(root) {
            return false;
        }
        self.roots.retain(|existing| existing != root);
        self.roots.insert(0, root.to_owned());
        self.roots.truncate(MAX_ROOTS);
        true
    }

    /// Is `candidate` a listed root, or inside one?
    pub(crate) fn covers(&self, candidate: &str) -> bool {
        is_absolute(candidate)
            && self
                .roots
                .iter()
                .any(|root| Path::new(candidate).starts_with(Path::new(root)))
    }

    /// Fold an older list (the file) in BEHIND this one (this session's picks),
    /// so loading late never drops a root chosen before the load.
    pub(crate) fn absorb(&mut self, older: GrantList) {
        for root in older.roots {
            if self.roots.len() == MAX_ROOTS {
                break;
            }
            if !self.roots.contains(&root) {
                self.roots.push(root);
            }
        }
    }

    /// The roots, newest first.
    pub(crate) fn roots(&self) -> &[String] {
        &self.roots
    }
}

fn is_absolute(path: &str) -> bool {
    !path.is_empty() && Path::new(path).is_absolute()
}

#[cfg(test)]
#[path = "registry.test.rs"]
mod tests;
