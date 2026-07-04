//! Supported-extension gate for every "open this path" entry point.
//!
//! Purpose: Single source of truth for which file extensions VMark accepts,
//! plus the predicates built on it. Extracted verbatim from `lib.rs` to keep
//! that file under the size gate. Used by CLI arg filtering, Finder
//! `RunEvent::Opened` filtering, `validate_openable_path`, and the macOS
//! quarantine strip. Mirrors the TS registry's `getSupportedExtensions()`;
//! parity enforced by `scripts/check-ext-sync.sh` (ADR-12).

/// Accepted file extensions (lowercased, no leading dot).
pub(crate) const SUPPORTED_EXTENSIONS: &[&str] = &[
    // Markdown
    "md", "markdown", "mdown", "mkd", "mdx", // Plain text
    "txt", // Phase 2 data formats
    "json", "jsonl", "yaml", "yml", "toml", // Phase 3 visual-render formats
    "mmd", "svg", "html", "htm", // Phase 4 code viewers
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "css", "sh", "bash", "rb", "lua",
    // Media viewer — images (svg is above, its own format)
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "avif", "apng", "heic", "heif",
    "tiff", "tif", // Media viewer — video
    "mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv", "mpeg", "mpg", "wmv", "flv", "3gp",
    // Media viewer — audio
    "mp3", "m4a", "ogg", "oga", "wav", "flac", "aac", "opus", "weba", "aiff", "wma",
];

/// True if `path` has any registered format's extension (case-insensitive).
///
/// Only inspects the extension — does not touch the filesystem. Callers
/// that also need existence / file-type checks should compose this with
/// `path.exists()` / `path.is_file()` as needed.
pub(crate) fn has_supported_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|allowed| *allowed == lowered)
        })
        .unwrap_or(false)
}

/// True if `path` refers to an existing, regular, registered-extension file.
///
/// Single gate used by every "open this path" entry point (CLI args,
/// Finder `RunEvent::Opened`, `open_*_in_new_window` commands) so they
/// all agree on which paths VMark will accept.
pub(crate) fn is_openable_supported(path: &std::path::Path) -> bool {
    path.is_file() && has_supported_extension(path)
}

/// Pure wrapper over the Windows/Linux CLI-args filter.
///
/// Extracted so the filter's acceptance policy can be unit-tested
/// exhaustively — the real call site in `app_setup::setup_app` only differs
/// by where the input `Vec<String>` comes from (`std::env::args().skip(1)`).
///
/// On macOS this function is only reached from the test module; CLI args
/// aren't used (Finder dispatches via `RunEvent::Opened`). Suppress the
/// unused-warning there.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn filter_supported_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| is_openable_supported(std::path::Path::new(arg)))
        .collect()
}

#[cfg(test)]
#[path = "supported_files.test.rs"]
mod tests;
