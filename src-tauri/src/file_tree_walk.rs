//! # File Tree Walk
//!
//! Purpose: list a workspace's WHOLE tree for the sidebar in one command, off the
//! IPC thread, with the directories nobody wants to see pruned before they are
//! read (#1357).
//!
//! Pipeline: Frontend invoke("list_directory_tree") → this module → one blocking
//! recursive readdir → nested `TreeEntry` nodes.
//!
//! Key decisions:
//!   - ONE round trip per refresh. The explorer used to recurse in JavaScript with
//!     one `list_directory_entries` IPC per directory, serially awaited; a
//!     Downloads-sized root took seconds per scan, and that slowness was the fuel
//!     of the rescan loop in #1357 (a scan long enough for an fs event to land
//!     during it re-armed itself forever). Here the walk is a single
//!     `spawn_blocking` task.
//!   - Directories are PRUNED, files are not filtered: the file-type filter is a
//!     registry-driven JavaScript predicate and stays client-side. What never gets
//!     descended: `content_search::matching::ALWAYS_SKIP` (the same floor the workspace
//!     search applies — the file tree was the one traversal without it), the
//!     user's `excludeFolders`, and hidden directories when hidden entries are off.
//!   - Bounded: at most `MAX_TREE_NODES` entries and `MAX_TREE_DEPTH` levels; past
//!     either, `truncated` is reported so the UI can say the tree is partial rather
//!     than lie about an absence. A symlink is never descended (`file_type()` of
//!     the link itself is not a directory), so a link cycle cannot recurse.
//!   - An unreadable SUBdirectory renders as an empty folder flagged `unreadable`
//!     (one TCC-denied folder must not blank the tree); an unreadable ROOT is the
//!     command's error, so the user is told rather than shown an empty workspace.

use serde::{Deserialize, Serialize};
use std::fs;

use crate::command_error::{CommandError, ErrorCode};
use crate::content_search::matching::ALWAYS_SKIP;

/// One node of the listed tree; folders carry their (pruned) children.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    #[serde(rename = "isHidden")]
    pub is_hidden: bool,
    /// The directory could not be read (permission, TCC, vanished): shown empty.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unreadable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeEntry>>,
}

/// What the caller asks the walk to leave out.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TreeOptions {
    /// User-configured folder names never descended (in addition to ALWAYS_SKIP).
    #[serde(default)]
    pub exclude_folders: Vec<String>,
    /// Descend hidden directories too. Hidden FILES are always listed with their
    /// flag; the client decides whether to show them.
    #[serde(default)]
    pub show_hidden: bool,
}

/// The walk's result: the root's children and whether a bound was hit.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TreeListing {
    pub entries: Vec<TreeEntry>,
    pub truncated: bool,
}

/// Total entries one listing may carry — bounds the IPC payload and the memory of
/// a root like `~` (#1357). The workspace search's own cap is the same order.
pub const MAX_TREE_NODES: usize = 50_000;
/// Nesting levels descended below the root.
pub const MAX_TREE_DEPTH: usize = 64;

/// List the whole tree under `path` in one call. See the module doc.
///
/// # Errors
/// `io` when the ROOT itself cannot be read (the message is the OS's), `internal`
/// when the blocking task itself failed.
#[tauri::command]
pub async fn list_directory_tree(
    path: String,
    options: TreeOptions,
) -> Result<TreeListing, CommandError> {
    tokio::task::spawn_blocking(move || list_directory_tree_blocking(&path, &options))
        .await
        .map_err(|e| {
            CommandError::new(
                ErrorCode::Internal,
                format!("Directory tree task failed: {e}"),
            )
        })?
        .map_err(|message| CommandError::new(ErrorCode::Io, message))
}

struct Walk<'a> {
    options: &'a TreeOptions,
    nodes: usize,
    truncated: bool,
}

impl Walk<'_> {
    fn descends(&self, name: &str, is_hidden: bool) -> bool {
        if ALWAYS_SKIP.contains(&name) {
            return false;
        }
        if self.options.exclude_folders.iter().any(|f| f == name) {
            return false;
        }
        self.options.show_hidden || !is_hidden
    }

    /// Children of `dir`, or `Err` when it cannot be read.
    fn list(&mut self, dir: &str, depth: usize) -> Result<Vec<TreeEntry>, String> {
        let read = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {e}"))?;
        let mut out = Vec::new();
        for entry in read.flatten() {
            if self.nodes >= MAX_TREE_NODES {
                self.truncated = true;
                break;
            }
            self.nodes += 1;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path().to_string_lossy().to_string();
            let is_directory = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let is_hidden = crate::file_tree::compute_is_hidden(&name, &entry);
            let mut node = TreeEntry {
                name,
                path,
                is_directory,
                is_hidden,
                unreadable: false,
                children: None,
            };
            if is_directory && self.descends(&node.name, is_hidden) {
                if depth >= MAX_TREE_DEPTH {
                    self.truncated = true;
                    node.children = Some(Vec::new());
                } else {
                    match self.list(&node.path, depth + 1) {
                        Ok(children) => node.children = Some(children),
                        Err(e) => {
                            log::warn!("[file-tree] unreadable directory {}: {e}", node.path);
                            node.unreadable = true;
                            node.children = Some(Vec::new());
                        }
                    }
                }
            } else if is_directory {
                node.children = Some(Vec::new()); // pruned: listed, never descended
            }
            out.push(node);
        }
        Ok(out)
    }
}

/// Synchronous core of `list_directory_tree` (runs inside `spawn_blocking`).
pub(crate) fn list_directory_tree_blocking(
    path: &str,
    options: &TreeOptions,
) -> Result<TreeListing, String> {
    let mut walk = Walk {
        options,
        nodes: 0,
        truncated: false,
    };
    let entries = walk.list(path, 0)?;
    if walk.truncated {
        log::warn!("[file-tree] listing truncated for {path}: {MAX_TREE_NODES} nodes / {MAX_TREE_DEPTH} levels");
    }
    Ok(TreeListing {
        entries,
        truncated: walk.truncated,
    })
}

#[cfg(test)]
#[path = "file_tree_walk.test.rs"]
mod tests;
