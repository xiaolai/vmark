//! # Files
//!
//! Purpose: the document-file commands the frontend calls directly — opening
//! (Finder/CLI queueing), saving, claiming a new name, metadata and trash, and
//! the sidebar's one-call tree listing. Each child is its own module; this
//! file only groups them.
//!
//! - `open` — Finder/CLI open queueing, hot-open delivery, macOS reopen
//! - `write` — the atomic save command and its list guard (`write::anchored`
//!   holds the folder on Unix)
//! - `create` — `create_file_exclusive`, sharing `write`'s guard
//! - `ops` — file size and move-to-trash
//! - `block_count` — the markdown block estimate that routes WYSIWYG vs Source
//! - `tree_walk` — `list_directory_tree`; `tree` — its hidden-entry rule
//! - `path_identity` — file identity and path-text cleanup, shared by:
//!   `entry_spelling` — the journal's document key (stored entry spelling,
//!   never folded) and `write::lock_key` — the per-target write lock's key
//!   (broad folding)

pub(crate) mod block_count;
pub(crate) mod create;
pub(crate) mod entry_spelling;
pub(crate) mod open;
pub(crate) mod ops;
pub(crate) mod path_identity;
mod tree;
pub(crate) mod tree_walk;
pub(crate) mod write;
