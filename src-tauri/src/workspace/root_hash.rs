//! Workspace root hashing: turns a root path into its config file name.
//!
//! Purpose: these hashes ARE file names on disk, so the normalization here decides
//! which workspace reads which config.
//!
//! @module workspace/root_hash

use sha2::{Digest, Sha256};

/// Truncated SHA-256 of a workspace root path, hex-encoded, for use as a filename.
/// The normalization is deliberately NOT "tidied up": these hashes ARE filenames on
/// disk, so changing it silently orphans every existing user's config. Frozen.
/// The one exception: off Windows a trailing backslash is part of the directory's
/// name, so `/a\` must not share `/a`'s config file. A root ending that way starts
/// fresh, because the file it used to read cannot be told apart from `/a`'s.
fn hash_root_path_bytes(root_path: &str, n: usize) -> String {
    let normalized = root_without_trailing_separators(root_path, cfg!(windows));
    let hash = Sha256::digest(normalized.as_bytes());
    hash.iter().take(n).map(|b| format!("{:02x}", b)).collect()
}

/// `root_path` as hashed: trailing `/` removed, then trailing `\` on Windows only.
pub(super) fn root_without_trailing_separators(root_path: &str, windows: bool) -> &str {
    let trimmed = root_path.trim_end_matches('/');
    if windows {
        trimmed.trim_end_matches('\\')
    } else {
        trimmed
    }
}

/// Current filename hash: 16 bytes (128 bits) → 2^64 collision space at the
/// birthday bound, vastly more than a user will ever accumulate.
pub(crate) fn hash_root_path(root_path: &str) -> String {
    hash_root_path_bytes(root_path, 16)
}

/// Legacy 8-byte hash used in releases <= 0.7.22 (2^32 birthday bound). Read-only:
/// `migrate_legacy_hash_filename` renames such a file to the 16-byte name on load.
///
/// Sunset: remove this, `get_legacy_workspace_config_path`, the hash half of
/// `workspace/legacy.rs` and `migrate_legacy_hash_filename` once no supported
/// upgrade path starts below 0.7.23.
pub(crate) fn legacy_hash_root_path(root_path: &str) -> String {
    hash_root_path_bytes(root_path, 8)
}
