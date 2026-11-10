//! Per-file asset-protocol access grants for the media viewer.
//!
//! Media tabs never read their file as text, so they skip the `readTextFile`
//! path that extends the scopes for text documents. The frontend calls
//! `grant_asset_access` before mounting the media surface so `convertFileSrc`
//! (asset://) can serve the file instead of returning 403.
//!
//! Threat model (WI-LX1.2). The asset-protocol scope in `tauri.conf.json` is
//! the fs capability's static roots — `$HOME/**`, `/Volumes/**`, `/mnt/**`,
//! `/media/**`, plus `C:\` to `F:\` on Windows via `tauri.windows.conf.json`
//! (pinned by `capabilities.test.rs`). Until 0.9.84 it was `**/*`, which matched
//! every absolute path without a dot component, so this gate guarded nothing.
//! It is now the boundary: this command is invocable from webview JS, so an
//! injected script could otherwise grant itself asset:// read of ANY path
//! (e.g. `/etc/passwd`) and exfiltrate it. Grants are therefore restricted to
//! files whose extension is a previewable media type — the only thing the
//! media viewer ever legitimately needs.
//!
//! The extension judged is the TARGET's: Tauri also allows the canonical form
//! of whatever it grants, so a link named `secret.png` would otherwise grant
//! the file it points at. The canonical target is what is checked and what is
//! granted, and the grant is confirmed afterwards (`fs_scope::
//! confirm_grant_target`): a target swapped for a link during the grant call
//! fails the grant, and — as that function states — the stray allow it caused
//! lasts until restart, because revoking it could revoke a file the user
//! opened.
//!
//! The grant is asset-protocol ONLY. The media viewer loads over asset:// and
//! nothing else, and a runtime fs grant would be accepted by every fs command
//! the capability permits, write and remove included (`fs_scope.rs`).
//!
//! The scope matches dot-prefixed segments (`requireLiteralLeadingDot: false`,
//! the fs plugin's setting): Tauri applies one glob option to the whole scope,
//! so without it neither the static roots nor a workspace's runtime `root/**`
//! could serve `.gitbook/assets/x.png`. The reach equals the fs scope's.
//!
//! What it does NOT bound is WHICH media file: any image, video or audio file
//! the user can read, anywhere on disk, is readable over asset://.

/// The media-extension lists — the SAME file `src/utils/mediaExtensions.ts`
/// imports, embedded at compile time. It used to be a second hand-kept copy
/// held in step by a test that parsed the TypeScript source as text; now there
/// is nothing to keep in step. (`SUPPORTED_EXTENSIONS` in `supported_files.rs`
/// still mirrors it, guarded by `src/lib/formats/extSync.test.ts`.)
const MEDIA_EXTENSIONS_JSON: &str = include_str!("../../src/utils/mediaExtensions.json");
const MEDIA_KINDS: [&str; 3] = ["image", "video", "audio"];

/// `{ "image": [...], "video": [...], "audio": [...] }` → every extension,
/// in file order. Refuses, by name, anything but exactly those three
/// non-empty lists of lowercase bare extensions with none named twice — the
/// same rules `mediaExtensions.test.ts` holds the file to.
fn parse_media_extensions(json: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("mediaExtensions.json is not JSON: {e}"))?;
    let object = value
        .as_object()
        .ok_or("mediaExtensions.json must be an object of image/video/audio lists")?;
    if let Some(extra) = object.keys().find(|k| !MEDIA_KINDS.contains(&k.as_str())) {
        return Err(format!("mediaExtensions.json: unknown kind {extra:?}"));
    }
    let mut all: Vec<String> = Vec::new();
    for kind in MEDIA_KINDS {
        let list = object
            .get(kind)
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("mediaExtensions.json: {kind:?} must be a list"))?;
        if list.is_empty() {
            return Err(format!("mediaExtensions.json: {kind:?} is empty"));
        }
        for ext in list {
            let ext = ext
                .as_str()
                .filter(|e| !e.is_empty() && e.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
                .ok_or_else(|| format!("mediaExtensions.json: {kind:?} holds {ext}, not a lowercase bare extension"))?;
            if all.iter().any(|seen| seen == ext) {
                return Err(format!("mediaExtensions.json: {ext:?} is named twice"));
            }
            all.push(ext.to_string());
        }
    }
    Ok(all)
}

/// Media extensions eligible for an asset-protocol grant (lowercased, no dot).
fn media_extensions() -> &'static [String] {
    static PARSED: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
        // Compiled in, and parsed by `media_extensions_come_from_the_shared_file`.
        parse_media_extensions(MEDIA_EXTENSIONS_JSON)
            .expect("the embedded mediaExtensions.json is valid")
    });
    &PARSED
}

/// True if `path` has a previewable media extension (case-insensitive).
///
/// Extension-only check — does not touch the filesystem. A traversal string
/// like `../../etc/passwd` has no media extension and is rejected.
fn is_media_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            media_extensions().contains(&lowered)
        })
        .unwrap_or(false)
}

/// Grant the webview asset:// read access to one media file.
///
/// Rejects anything that is not a previewable media file — by its name, and by
/// the file its name resolves to — so injected webview JS can never widen the
/// asset-protocol scope to arbitrary files. A refusal or a failed grant is an
/// `Err`, and `MediaView` falls back on the 403 that follows.
///
/// `async` and off the IPC thread: resolving a path on a dead network mount
/// blocks for the mount's timeout.
#[tauri::command]
pub async fn grant_asset_access<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || grant_media(&app, std::path::Path::new(&path)))
        .await
        .map_err(|e| format!("asset grant task failed: {e}"))?
}

fn grant_media<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &std::path::Path,
) -> Result<(), String> {
    use tauri::Manager;
    const NOT_MEDIA: &str = "not a previewable media file";
    if !is_media_extension(path) {
        return Err(NOT_MEDIA.to_string());
    }
    let target = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve the media file: {e}"))?;
    if !is_media_extension(&target) {
        return Err(NOT_MEDIA.to_string());
    }
    app.asset_protocol_scope()
        .allow_file(&target)
        .map_err(|e| e.to_string())?;
    crate::fs_scope::confirm_grant_target(&target, || {
        target.canonicalize().map_err(|e| e.to_string())
    })
}

#[cfg(test)]
#[path = "asset_access.test.rs"]
mod tests;
