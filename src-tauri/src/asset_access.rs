//! Per-file asset-protocol access grants for the media viewer.
//!
//! Media tabs never read their file as text, so they skip the `readTextFile`
//! path that extends the fs/asset scope for text documents. The frontend calls
//! `grant_asset_access` before mounting the media surface so `convertFileSrc`
//! (asset://) can serve the file instead of returning 403.
//!
//! Security: this command is invocable from webview JS, so a compromised or
//! injected script could otherwise grant asset:// read access to ANY path
//! (e.g. `/etc/passwd`) and exfiltrate it. Grants are therefore restricted to
//! files whose extension is a previewable *media* type — the only thing the
//! media viewer ever legitimately needs.

/// Media extensions eligible for an asset-protocol grant (lowercased, no dot).
///
/// Source of truth: `src/utils/mediaExtensions.ts` (image + video + audio).
/// Mirrors the media block of `SUPPORTED_EXTENSIONS` in `lib.rs`; keep the two
/// in sync when adding a media format. (Deliberately not wired into
/// `scripts/check-ext-sync.sh`, which only checks `SUPPORTED_EXTENSIONS`.)
const MEDIA_EXTENSIONS: &[&str] = &[
    // Images (svg is a previewable image for the media viewer)
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "svg", "bmp", "ico", "avif", "apng", "heic",
    "heif", "tiff", "tif", // Video
    "mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv", "mpeg", "mpg", "wmv", "flv", "3gp",
    // Audio
    "mp3", "m4a", "ogg", "oga", "wav", "flac", "aac", "opus", "weba", "aiff", "wma",
];

/// True if `path` has a previewable media extension (case-insensitive).
///
/// Extension-only check — does not touch the filesystem. A traversal string
/// like `../../etc/passwd` has no media extension and is rejected.
fn is_media_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            MEDIA_EXTENSIONS.iter().any(|allowed| *allowed == lowered)
        })
        .unwrap_or(false)
}

/// Grant the webview asset:// + fs read access to one media file.
///
/// Rejects non-media paths so injected webview JS can never widen the
/// asset-protocol scope to arbitrary files. The `allow_fs_read` step itself
/// stays best-effort (failures are logged, not fatal) — `MediaView` already
/// falls back on a 403 — but a non-media path is a hard `Err` that never
/// extends the scope.
#[tauri::command]
pub fn grant_asset_access(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_media_extension(std::path::Path::new(&path)) {
        return Err("not a previewable media file".to_string());
    }
    crate::allow_fs_read(&app, &path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn accepts_image_video_audio_extensions() {
        for p in [
            "/x/a.png",
            "/x/a.PNG",
            "/x/clip.mp4",
            "/x/song.mp3",
            "/x/vector.svg",
        ] {
            assert!(is_media_extension(Path::new(p)), "should accept {p}");
        }
    }

    #[test]
    fn rejects_non_media_and_traversal_paths() {
        for p in [
            "/x/lib.rs",
            "/x/notes.txt",
            "../../etc/passwd",
            "/etc/passwd",
            "/x/noext",
            "/x/.hidden",
        ] {
            assert!(!is_media_extension(Path::new(p)), "should reject {p}");
        }
    }
}
