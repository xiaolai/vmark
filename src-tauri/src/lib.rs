//! # VMark Tauri Application
//!
//! Purpose: Entry point for the Tauri backend — wires together all modules,
//! registers commands, configures plugins, and handles app-level events.
//!
//! Key decisions:
//!   - Window close is intercepted for document windows (main, doc-*) to allow
//!     dirty-document prompts; non-document windows close immediately.
//!   - File opens from Finder are queued in `FILE_OPEN_STATE` until the frontend
//!     signals readiness, solving a cold-start race condition. Only .md/.markdown
//!     files are accepted; other extensions are skipped. Hot opens (app already
//!     running) use `app.emit()` (global broadcast) — NOT `window.emit()` — so the
//!     frontend's global `listen()` in `useFinderFileOpen` receives them. Tauri v2
//!     webview-specific events are not delivered to global `listen()`.
//!   - macOS Reopen event (dock click) creates a new main window when none visible,
//!     restoring the user's most-recent workspace via
//!     `window_manager::pick_reopen_workspace_root` so closing the last tab and
//!     re-clicking the dock doesn't drop them into an orphan untitled doc.
//!   - Default shell resolved via `getpwuid_r` → `$SHELL` → `/bin/sh` (reliable in
//!     GUI apps). Available shells detected from `/etc/shells` (Unix) or `where.exe`
//!     (Windows), always returning absolute paths.
//!   - `machine_id_hash()` generates a stable anonymous device identifier via
//!     SHA-256(hostname + OS + arch), sent as `X-Machine-Id` header on update checks.
//!   - AI provider API keys are persisted in the OS keychain via the `secure_store`
//!     module, never in plaintext config.

rust_i18n::i18n!("locales", fallback = "en");

mod ai_provider;
mod app_paths;
mod content_search;
mod content_server;
mod external_editor;
mod file_ops;
mod file_tree;
pub mod genies;
mod gha_workflow;
mod hot_exit;
mod mcp_bridge;
mod mcp_bridge_path_guard;
mod mcp_config;
mod mcp_server;
mod menu;
mod menu_events;
mod pandoc;
mod pty;
mod quarantine;
mod quit;
mod secure_store;
mod shell_integration;
mod tab_transfer;
mod task;
mod watcher;
mod window_manager;
pub mod workflow;
mod workspace;
mod workspace_transfer;

#[cfg(target_os = "macos")]
mod app_nap;
#[cfg(target_os = "macos")]
mod cli_install;
#[cfg(target_os = "macos")]
mod dock_recent;
#[cfg(target_os = "macos")]
mod macos_menu;
#[cfg(target_os = "macos")]
mod pdf_export;
mod window_status;

use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Listener, Manager};

/// A file open request queued during cold start before the frontend is ready.
///
/// Solves the race condition where Finder opens a file but React hasn't mounted yet.
#[derive(Clone, serde::Serialize)]
pub struct PendingFileOpen {
    pub path: String,
    pub workspace_root: Option<String>,
}

/// Combined Finder file-open state — the readiness flag and the pending queue
/// live behind ONE mutex so the readiness check and the queue insertion happen
/// in a single critical section (WI-0.8, C3). See `window_manager::FileOpenState`.
static FILE_OPEN_STATE: Mutex<window_manager::FileOpenState> =
    Mutex::new(window_manager::FileOpenState::new());

/// Get and clear pending file opens - called by frontend when ready.
/// Marks the frontend ready and drains the queue atomically (one lock) so a
/// Finder open landing mid-call is never dropped or double-delivered.
#[tauri::command]
fn get_pending_file_opens() -> Vec<PendingFileOpen> {
    let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
    window_manager::mark_ready_and_drain(&mut state)
}

/// Runtime-extend the fs plugin's read scope for a path the user asked to open.
///
/// Tauri's static capability scope in `capabilities/default.json` grants
/// read access only under `$HOME/**`, `/Volumes/**`, `/mnt/**`, `/media/**`.
/// Files arriving via Finder (`RunEvent::Opened`), CLI args, or explicit
/// "Open in new window" commands can live anywhere on disk (`/private/tmp`,
/// `/etc`, etc.). Without extension, `readTextFile` in the webview rejects
/// them with `forbidden path`, leaving tabs with empty content.
///
/// This mirrors what `tauri_plugin_dialog` does automatically for
/// user-picked paths — the intent signal (user chose this file) is the same.
/// Best-effort: failures are logged, not propagated.
pub(crate) fn allow_fs_read<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    use tauri_plugin_fs::FsExt;
    if let Err(e) = app.fs_scope().allow_file(path) {
        log::warn!("[fs-scope] Failed to allow file '{}': {}", path, e);
    }
}

/// Accepted file extensions (lowercased, without the leading dot).
///
/// Single source of truth for CLI arg filtering, Finder `Opened`
/// filtering, the `validate_openable_path` security gate, and the
/// macOS quarantine strip pass. Mirrors the TypeScript format
/// registry's `getSupportedExtensions()` output; CI script
/// `scripts/check-ext-sync.sh` enforces parity (ADR-12).
///
/// The original markdown-only list is preserved as
/// `MARKDOWN_ONLY_EXTENSIONS` for places that genuinely mean "markdown
/// adapter only" (e.g. parts of the macOS About-dialog narrative).
pub(crate) const SUPPORTED_EXTENSIONS: &[&str] = &[
    // Markdown
    "md", "markdown", "mdown", "mkd", "mdx", // Plain text
    "txt", // Phase 2 data formats
    "json", "jsonl", "yaml", "yml", "toml", // Phase 3 visual-render formats
    "mmd", "svg", "html", "htm", // Phase 4 code viewers
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "css", "sh", "bash", "rb", "lua",
];

/// Strict markdown-only extensions — kept for callers that genuinely
/// mean "markdown editor candidate" rather than "any registered format."
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) const MARKDOWN_ONLY_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];

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
/// exhaustively — the real call site in `run()` only differs by where
/// the input `Vec<String>` comes from (`std::env::args().skip(1)`).
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

/// Debug logging from frontend (logs to terminal, debug builds only)
#[cfg(debug_assertions)]
#[tauri::command]
fn debug_log(message: String) {
    log::debug!("[Frontend] {}", message);
}

/// Write HTML content to a temp file for browser-based printing and PDF export.
/// Returns the file path so the frontend can open it via plugin-opener or read it back.
///
/// Uses the Tauri app data directory so the path falls within the FS plugin's
/// allowed scope (needed for PDF export window to read the file via `readTextFile`).
///
/// Cleans up stale temp files (older than 1 hour) on each call to prevent
/// accumulation from previous export/print sessions.
#[tauri::command]
fn write_temp_html(app: tauri::AppHandle, html: String) -> Result<String, String> {
    use std::io::Write;

    // Reject obviously oversized input (>50 MB)
    if html.len() > 50 * 1024 * 1024 {
        return Err(rust_i18n::t!("errors.core.htmlTooLarge").to_string());
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let dir = app_data.join("temp");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create temp directory {}: {}", dir.display(), e))?;

    // Clean up stale temp files (older than 1 hour)
    cleanup_stale_temp_files(&dir);

    // Use tempfile for kernel-guaranteed unique filename (no PID+time guessability)
    let mut temp = tempfile::Builder::new()
        .prefix("vmark-export-")
        .suffix(".html")
        .tempfile_in(&dir)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Write content first, then persist (keep on disk after handle drops)
    temp.write_all(html.as_bytes())
        .map_err(|e| format!("Failed to write temp HTML file: {}", e))?;
    let path = temp.path().to_path_buf();
    temp.persist(&path)
        .map_err(|e| format!("Failed to persist temp file: {}", e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Remove temp HTML files older than 1 hour to prevent accumulation.
fn cleanup_stale_temp_files(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("vmark-export-") && !name.starts_with("print-") {
            continue;
        }
        if !name.ends_with(".html") {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

/// Sentinel prefix returned when the target's parent directory does not
/// exist (renamed/deleted externally). The frontend (`saveToPath.ts`) parses
/// this to route the user into the Save As flow. Keep in sync with
/// `PARENT_MISSING_PREFIX` in `src/utils/saveToPath.ts`.
pub const PARENT_MISSING_ERROR_PREFIX: &str = "PARENT_MISSING:";

/// Synchronous core of `atomic_write_file`. Extracted so it can be unit-tested
/// without spinning up a tokio runtime. Same semantics as the async wrapper.
fn atomic_write_file_sync(target: &std::path::Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Defense-in-depth: reject path traversal to prevent writing outside
    // intended directories if the webview is compromised.
    if target
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(rust_i18n::t!("errors.core.pathTraversal").to_string());
    }

    if !target.is_absolute() {
        return Err(rust_i18n::t!("errors.core.pathNotAbsolute").to_string());
    }

    let dir = target.parent().ok_or("File path has no parent directory")?;

    // Surface a structured error when the parent directory is gone (e.g.,
    // renamed or deleted externally while the file was open). Without this
    // explicit check, NamedTempFile leaks a raw "No such file or directory
    // (os error 2)" with a tempfile name, which looks like VMark dropped
    // a temp file. The frontend matches the `PARENT_MISSING:` prefix to
    // route the user into the Save As flow.
    if !dir.is_dir() {
        return Err(format!("{}{}", PARENT_MISSING_ERROR_PREFIX, dir.display()));
    }

    let mut tmp =
        NamedTempFile::new_in(dir).map_err(|e| format!("Failed to create temp file: {}", e))?;

    tmp.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    tmp.flush()
        .map_err(|e| format!("Failed to flush temp file: {}", e))?;

    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync temp file: {}", e))?;

    tmp.persist(target)
        .map_err(|e| format!("Failed to persist file: {}", e))?;

    // Sync parent directory for crash safety
    if let Ok(dir_file) = std::fs::File::open(dir) {
        let _ = dir_file.sync_all();
    }

    Ok(())
}

/// Atomic file write using temp file + rename (async Tauri command variant).
///
/// Prevents data loss on crash by writing to a temporary file in the same
/// directory, flushing to disk, then atomically renaming over the target.
///
/// NOTE: A separate sync variant exists in `app_paths::atomic_write_file` for
/// internal use (workspace config, MCP port file). They are intentionally
/// separate — this one is async for the frontend invoke path.
#[tauri::command]
async fn atomic_write_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        atomic_write_file_sync(std::path::Path::new(&path), &content)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Return the login shell's PATH — needed by the integrated terminal so that
/// CLI tools (node, claude, etc.) are discoverable, matching system terminal behavior.
///
/// Delegates to `ai_provider::login_shell_path()` which caches the result.
#[tauri::command]
fn get_login_shell_path() -> String {
    ai_provider::login_shell_path()
}

/// Return the user's default shell.
///
/// Fallback chain:
/// - macOS/Linux: `getpwuid(getuid())` → `$SHELL` → `/bin/sh`
///   `getpwuid` reads the login shell from the user database, which is
///   reliable even in GUI apps where `$SHELL` may not be set.
/// - Windows: `%COMSPEC%` → `%SystemRoot%\System32\cmd.exe` → `C:\Windows\System32\cmd.exe`
#[tauri::command]
fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        // Prefer %COMSPEC%, fall back to absolute cmd.exe path (never bare "cmd.exe")
        std::env::var("COMSPEC")
            .ok()
            .filter(|v| shell_path_is_valid(v))
            .unwrap_or_else(windows_absolute_cmd)
    } else {
        login_shell_from_passwd()
            .filter(|s| shell_path_is_valid(s))
            .or_else(|| {
                std::env::var("SHELL")
                    .ok()
                    .filter(|s| shell_path_is_valid(s))
            })
            .unwrap_or_else(|| "/bin/sh".to_string())
    }
}

/// Read login shell from the Unix user database via `getpwuid_r`.
///
/// Returns `None` if the lookup fails or the shell field is empty.
/// Retries with a larger buffer on `ERANGE` (large NSS entries).
#[cfg(unix)]
fn login_shell_from_passwd() -> Option<String> {
    use std::ffi::CStr;
    use std::mem::MaybeUninit;

    // SAFETY: getuid() is always safe and returns the real user ID.
    let uid = unsafe { libc::getuid() };

    // Start with sysconf hint, fall back to 1024
    let init_size = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let mut buf_size = if init_size > 0 {
        init_size as usize
    } else {
        1024
    };

    loop {
        let mut pwd = MaybeUninit::<libc::passwd>::uninit();
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let mut buf = vec![0u8; buf_size];

        // SAFETY: getpwuid_r is the reentrant (thread-safe) variant.
        // We pass valid pointers and a buffer of known size.
        let rc = unsafe {
            libc::getpwuid_r(
                uid,
                pwd.as_mut_ptr(),
                buf.as_mut_ptr() as *mut libc::c_char,
                buf.len(),
                &mut result,
            )
        };

        if rc == libc::ERANGE && buf_size < 1_048_576 {
            // Buffer too small — double and retry (cap at 1 MB)
            buf_size *= 2;
            continue;
        }

        if rc != 0 || result.is_null() {
            return None;
        }

        // SAFETY: result is non-null and points to initialized pwd.
        let pwd = unsafe { pwd.assume_init() };
        if pwd.pw_shell.is_null() {
            return None;
        }

        // SAFETY: pw_shell is a valid C string from the passwd entry.
        let shell = unsafe { CStr::from_ptr(pwd.pw_shell) };
        let shell_str = shell.to_str().ok()?.to_string();

        return if shell_str.is_empty() {
            None
        } else {
            Some(shell_str)
        };
    }
}

#[cfg(not(unix))]
fn login_shell_from_passwd() -> Option<String> {
    None
}

/// Build an absolute path to `cmd.exe` using `%SystemRoot%` (or fallback).
/// Never returns a bare "cmd.exe" that could resolve via CWD/PATH.
fn windows_absolute_cmd() -> String {
    let sys_root = std::env::var("SystemRoot")
        .or_else(|_| std::env::var("WINDIR"))
        .unwrap_or_else(|_| r"C:\Windows".to_string());
    let cmd = std::path::PathBuf::from(&sys_root)
        .join("System32")
        .join("cmd.exe");
    cmd.to_string_lossy().into_owned()
}

/// Resolve absolute path for a shell executable using `which`/`where`.
/// Returns `None` if the executable is not found.
fn resolve_windows_shell(name: &str) -> Option<String> {
    let output = ai_provider::which_command().arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    // where.exe may return multiple lines; take the first (highest priority) one
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?.trim().to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line)
    }
}

/// Check if a shell path exists and is executable (for validating env vars).
fn shell_path_is_valid(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.is_file() && is_executable(p)
}

/// List available shells on the system.
///
/// - macOS/Linux: reads `/etc/shells`, filters to existing executable paths, deduplicates.
///   Always includes the user's login shell (via `getpwuid` → `$SHELL` fallback).
/// - Windows: checks for known shell executables via `where.exe` (absolute path).
#[tauri::command]
fn list_available_shells() -> Vec<String> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        for candidate in &["powershell.exe", "pwsh.exe", "cmd.exe"] {
            if let Some(abs_path) = resolve_windows_shell(candidate) {
                shells.push(abs_path);
            }
        }
        // Always include %COMSPEC%
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !shells.iter().any(|s| s.eq_ignore_ascii_case(&comspec)) {
                shells.insert(0, comspec);
            }
        }
    } else {
        // Read /etc/shells, filter to existing executable files
        if let Ok(content) = std::fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                let path = std::path::Path::new(trimmed);
                if path.is_file() && is_executable(path) {
                    shells.push(trimmed.to_string());
                }
            }
        }
        // Always include the user's login shell (passwd → $SHELL fallback)
        let user_shell = login_shell_from_passwd().or_else(|| std::env::var("SHELL").ok());
        if let Some(shell) = user_shell {
            if !shells.contains(&shell) {
                shells.insert(0, shell);
            }
        }
        // Deduplicate while preserving order
        let mut seen = std::collections::HashSet::new();
        shells.retain(|s| seen.insert(s.clone()));
    }

    shells
}

/// Check if a file is executable by the current user (Unix: `access(X_OK)`).
#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::ffi::CString;
    let Ok(c_path) = CString::new(path.as_os_str().as_encoded_bytes()) else {
        return false;
    };
    // SAFETY: c_path is a valid null-terminated C string.
    unsafe { libc::access(c_path.as_ptr(), libc::X_OK) == 0 }
}

#[cfg(not(unix))]
fn is_executable(_path: &std::path::Path) -> bool {
    true // Windows executability is determined by extension, not permissions
}

/// Register a file with macOS Dock recent documents
#[cfg(target_os = "macos")]
#[tauri::command]
fn register_dock_recent(path: String) {
    dock_recent::register_recent_document(&path);
}

/// Compute a stable, anonymous machine identifier hash.
///
/// Input: `"vmark-machine-id-v1:" + hostname + ":" + OS + ":" + ARCH`
/// Output: 64-char lowercase hex SHA-256 digest.
///
/// The hash is stable across restarts, updates, and user accounts on the
/// same machine. It is not reversible without knowing the hostname.
/// The app-specific prefix prevents cross-app correlation.
fn machine_id_hash() -> String {
    let hostname = gethostname::gethostname().to_string_lossy().into_owned();
    let input = format!(
        "vmark-machine-id-v1:{}:{}:{}",
        hostname,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

/// One-time application setup: menus, macOS fixes, legacy cleanup, default
/// genies, CLI/Finder file-arg queueing, and the frontend "ready" listener.
///
/// Extracted from `run`'s former inline `.setup` closure so the setup steps are
/// individually readable and the builder chain stays declarative.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(pty::PtyState::default());
    let menu = menu::localized::create_localized_menu(app.handle(), None)?;
    app.set_menu(menu)?;

    // Disable App Nap so the webview stays active when backgrounded
    // (prevents MCP bridge timeouts from suspended JS)
    #[cfg(target_os = "macos")]
    app_nap::disable_app_nap();

    // Fix macOS Help/Window menus (workaround for muda bug)
    #[cfg(target_os = "macos")]
    macos_menu::apply_menu_fixes(app.handle());

    // Best-effort cleanup of legacy ~/.vmark/ directory
    app_paths::cleanup_legacy_home_dir(app.handle());

    // Install default AI genies (no-op if already present)
    if let Err(e) = genies::install_default_genies(app.handle()) {
        log::warn!("[Tauri] Failed to install default genies: {}", e);
    }

    // Windows/Linux: handle files passed as CLI arguments
    // (macOS uses RunEvent::Opened from Finder instead)
    #[cfg(not(target_os = "macos"))]
    {
        let file_args = filter_supported_args(std::env::args().skip(1));

        if !file_args.is_empty() {
            if let Ok(mut state) = FILE_OPEN_STATE.lock() {
                for path_str in file_args {
                    allow_fs_read(app.handle(), &path_str);
                    let workspace_root = window_manager::get_workspace_root_for_file(&path_str);
                    state.pending.push(PendingFileOpen {
                        path: path_str,
                        workspace_root,
                    });
                }
            }
        }
    }

    // Listen for "ready" events from frontend windows
    // This is used by menu_events to know when it's safe to emit events
    // The payload contains the window label as a string
    let app_handle = app.handle().clone();
    app.listen("ready", move |event| {
        // The payload is the window label
        if let Ok(label) = serde_json::from_str::<String>(event.payload()) {
            log::debug!("[Tauri] Window '{}' is ready", label);
            menu_events::mark_window_ready(&app_handle, &label);
        }
    });

    Ok(())
}

/// Intercept close requests for document windows so the frontend can run its
/// save/confirm flow. Non-document windows (settings) close normally.
fn handle_document_window_close_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::Emitter;
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let label = window.label();
        log::debug!("[Tauri] WindowEvent::CloseRequested for window '{}'", label);
        // Only intercept close for document windows
        if label == "main" || label.starts_with("doc-") {
            api.prevent_close();
            // Include target label in payload so frontend can filter
            let _ = window.emit("window:close-requested", label);
            log::debug!("[Tauri] Emitted window:close-requested to '{}'", label);
        }
        // Settings and other non-document windows close normally
    }
}

/// Handle an app exit request, preserving macOS last-window-close behavior
/// while letting Linux/Windows CLI launches terminate when no document windows
/// remain.
fn handle_exit_requested(app: &tauri::AppHandle, api: &tauri::ExitRequestApi, code: Option<i32>) {
    log::debug!("[Tauri] ExitRequested received, code={:?}", code);

    let has_doc_windows = app
        .webview_windows()
        .keys()
        .any(|label| quit::is_document_window_label(label));

    match quit::decide_exit_request_action(
        quit::is_exit_allowed(),
        has_doc_windows,
        quit::keep_alive_without_document_windows(),
    ) {
        quit::ExitRequestAction::AllowExit => {
            log::debug!("[Tauri] ExitRequested: allowing exit");
            if !quit::is_exit_allowed() {
                mcp_server::cleanup(app);
            }
        }
        quit::ExitRequestAction::PreventAndStartQuit => {
            api.prevent_exit();
            log::debug!("[Tauri] ExitRequested: starting quit flow");
            quit::start_quit(app);
        }
        quit::ExitRequestAction::PreventAndKeepAlive => {
            api.prevent_exit();
            log::debug!("[Tauri] ExitRequested: keeping app alive without document windows");
        }
    }
}

/// macOS dock-icon reactivation with no visible windows: recreate a window,
/// restoring the user's last workspace so they don't land in an orphan doc.
#[cfg(target_os = "macos")]
fn handle_reopen(app: &tauri::AppHandle, has_visible_windows: bool) {
    if has_visible_windows {
        return;
    }
    // Prefer creating a "main" window so useFinderFileOpen works. Fall back to
    // doc-N if "main" already exists.
    let ws = window_manager::pick_reopen_workspace_root();
    if app.get_webview_window("main").is_none() {
        // Reset readiness so any subsequent Opened events are queued until the
        // new main window's React mounts and drains them.
        FILE_OPEN_STATE
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .frontend_ready = false;
        let _ = window_manager::create_main_window(app, ws.as_deref());
    } else {
        let _ = window_manager::create_document_window(app, None, ws.as_deref());
    }
}

/// Convert Finder `RunEvent::Opened` URLs into queued/emitted file opens.
/// Directories open immediately; supported files are grouped by workspace root
/// and routed through the atomic `FILE_OPEN_STATE` decision.
#[cfg(target_os = "macos")]
fn handle_finder_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    // Convert URLs to file paths, handling directories immediately
    let mut file_paths = Vec::new();
    for url in urls {
        if let Ok(path) = url.to_file_path() {
            let Some(path_str) = path.to_str() else {
                continue;
            };
            if path.is_dir() {
                log::info!("[Finder] Opening directory: {}", path_str);
                let _ = window_manager::create_document_window(app, None, Some(path_str));
                continue;
            }
            // Only queue markdown files — non-markdown files would create
            // broken empty tabs (#661 audit gap 9.1). Uses the shared helper so
            // CLI and Finder filters stay in sync.
            if !is_openable_supported(&path) {
                log::warn!("[Finder] Skipping non-markdown file: {}", path_str);
                continue;
            }
            // Extend fs read scope so the webview's readTextFile succeeds for
            // paths outside the static capability scope. See allow_fs_read docs.
            allow_fs_read(app, path_str);
            file_paths.push(path_str.to_string());
        }
    }
    if file_paths.is_empty() {
        return;
    }
    log::info!("[Finder] Opening {} file(s)", file_paths.len());

    let groups = window_manager::group_paths_by_workspace(&file_paths);
    for (workspace_key, paths) in groups {
        let ws = if workspace_key.is_empty() {
            None
        } else {
            Some(workspace_key.as_str())
        };

        // Decide + queue atomically under one lock (WI-0.8, C3): the readiness
        // check and any queue insertion happen in a single critical section, so
        // a concurrent get_pending_file_opens can't interleave to drop or
        // double-deliver.
        let outcome = {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            window_manager::decide_file_open_locked(
                &mut state,
                app.get_webview_window("main").is_some(),
                paths,
                ws,
            )
        };

        match outcome {
            window_manager::FileOpenOutcome::Emit(payloads) => {
                emit_finder_opens_to_main(app, payloads);
            }
            window_manager::FileOpenOutcome::Queued { create_window } => {
                if create_window {
                    log::info!("[Finder] Queueing files, creating main window");
                    let _ = window_manager::create_main_window(app, None);
                } else {
                    log::info!("[Finder] Queueing files (frontend not ready)");
                }
            }
        }
    }
}

/// Emit decided Finder opens to the main window, re-queueing if the window
/// vanished between the decision and the emit (the decision is made under the
/// lock based on the main window existing THEN; `app.emit` is a global
/// broadcast that returns Ok even with no listener).
#[cfg(target_os = "macos")]
fn emit_finder_opens_to_main(app: &tauri::AppHandle, payloads: Vec<PendingFileOpen>) {
    use tauri::Emitter;
    if app.get_webview_window("main").is_none() {
        log::info!("[Finder] main window vanished before emit — re-queueing");
        {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            state.frontend_ready = false;
            state.pending.extend(payloads);
        }
        let _ = window_manager::create_main_window(app, None);
        return;
    }

    log::info!("[Finder] Emitting to main window");
    // app.emit() (global broadcast) so the frontend's global listen() in
    // useFinderFileOpen receives it. window.emit() is webview-specific and is
    // NOT delivered to @tauri-apps/api/event listen().
    let mut failed: Vec<PendingFileOpen> = Vec::new();
    for payload in payloads {
        if let Err(e) = app.emit("app:open-file", payload.clone()) {
            log::warn!("[Finder] emit failed, queueing: {e}");
            failed.push(payload);
        }
    }
    if !failed.is_empty() {
        // Emit failed mid-flight — re-queue and reset readiness so the open
        // isn't lost; create a main window if none remains to drain it.
        {
            let mut state = FILE_OPEN_STATE.lock().unwrap_or_else(|p| p.into_inner());
            state.frontend_ready = false;
            state.pending.extend(failed);
        }
        if app.get_webview_window("main").is_none() {
            let _ = window_manager::create_main_window(app, None);
        }
    }
}

/// Dispatch app-level `RunEvent`s to focused handlers.
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            handle_exit_requested(app, &api, code);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            quit::handle_window_destroyed(app, &label);
            menu_events::clear_window_ready(&label);
            tab_transfer::clear_unclaimed_transfer(&label);
            workspace_transfer::clear_unclaimed_transfer(&label);
            window_status::prune(app, &label);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => handle_reopen(app, has_visible_windows),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => handle_finder_opened(app, urls),
        _ => {}
    }
}

/// Build and run the Tauri application with all plugins, commands, and event handlers.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(5_000_000) // 5 MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // PTY managed via custom commands (pty.rs), not a plugin
        .plugin({
            let mid = machine_id_hash();
            tauri_plugin_updater::Builder::new()
                .header("X-Machine-Id", mid)
                // Infallible: `mid` is a lowercase hex Sha256 ([0-9a-f] only) — always a valid ASCII header value.
                .expect("machine id hash is always valid ASCII hex")
                .build()
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["settings", "pdf-export"])
                // Exclude VISIBLE from state restoration to prevent flash.
                // Windows start hidden (visible: false) and are shown only
                // after frontend emits "ready" event in mark_window_ready().
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .manage(workflow::commands::WorkflowRunnerState {
            running: std::sync::atomic::AtomicBool::new(false),
            cancel_requested: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            approvals: std::sync::Arc::new(workflow::approval::ApprovalRegistry::new()),
            current_execution: std::sync::Arc::new(std::sync::Mutex::new(None)),
        })
        .manage(content_server::ContentServerManager::new())
        .manage(window_status::WindowStatusRegistry::default())
        .invoke_handler(tauri::generate_handler![
            window_status::report_window_status,
            window_status::set_window_attention,
            window_status::clear_window_attention,
            window_status::get_window_statuses,
            window_status::focus_window,
            get_pending_file_opens,
            external_editor::open_in_external_editor,
            menu::update_recent_files,
            menu::update_recent_workspaces,
            menu::refresh_genies_menu,
            menu::hide_genies_menu,
            menu::rebuild_menu,
            menu::update_menu_accelerators,
            menu::sync_view_menu_state,
            menu::set_locale,
            window_manager::open_file_in_new_window,
            window_manager::open_workspace_in_new_window,
            window_manager::open_workspace_with_files_in_new_window,
            window_manager::open_settings_window,
            window_manager::close_window,
            window_manager::force_quit,
            window_manager::request_quit,
            quit::cancel_quit,
            quit::set_confirm_quit,
            watcher::start_watching,
            watcher::stop_watching,
            file_tree::list_directory_entries,
            file_ops::get_file_size_bytes,
            workspace::read_workspace_config,
            workspace::write_workspace_config,
            quarantine::strip_workspace_quarantine_cmd,
            mcp_server::mcp_bridge_start,
            mcp_server::mcp_bridge_stop,
            mcp_server::mcp_server_status,
            mcp_server::mcp_sidecar_health,
            mcp_server::mcp_bridge_client_count,
            mcp_server::mcp_bridge_connected_clients,
            mcp_bridge::commands::mcp_bridge_respond,
            mcp_bridge::commands::mcp_bridge_heartbeat,
            mcp_bridge_path_guard::mcp_bridge_check_path,
            mcp_config::commands::mcp_config_diagnose,
            mcp_config::commands::mcp_config_preview,
            mcp_config::commands::mcp_config_install,
            mcp_config::commands::mcp_config_uninstall,
            hot_exit::commands::hot_exit_capture,
            hot_exit::commands::hot_exit_restore,
            hot_exit::commands::hot_exit_inspect_session,
            hot_exit::commands::hot_exit_clear_session,
            hot_exit::commands::hot_exit_restore_multi_window,
            hot_exit::commands::hot_exit_get_window_state,
            hot_exit::commands::hot_exit_window_restore_complete,
            tab_transfer::detach_tab_to_new_window,
            tab_transfer::transfer_tab_to_existing_window,
            tab_transfer::claim_tab_transfer,
            tab_transfer::find_drop_target_window,
            tab_transfer::focus_existing_window,
            tab_transfer::remove_tab_from_window,
            workspace_transfer::detach_workspace_to_new_window,
            workspace_transfer::claim_workspace_transfer,
            workspace_transfer::ack_workspace_transfer,
            workspace_transfer::cancel_workspace_transfer,
            get_default_shell,
            get_login_shell_path,
            list_available_shells,
            genies::commands::get_genies_dir,
            genies::commands::list_genies,
            genies::commands::read_genie,
            workflow::commands::run_workflow,
            workflow::commands::cancel_workflow,
            workflow::commands::respond_workflow_approval,
            gha_workflow::commands::gha_lint,
            gha_workflow::commands::gha_fetch_action_yml,
            ai_provider::detect_ai_providers,
            ai_provider::run_ai_prompt,
            ai_provider::read_env_api_keys,
            secure_store::set_secret,
            secure_store::get_secret,
            secure_store::delete_secret,
            ai_provider::test_api_key,
            ai_provider::list_models,
            ai_provider::validate_model,
            #[cfg(debug_assertions)]
            debug_log,
            write_temp_html,
            atomic_write_file,
            #[cfg(target_os = "macos")]
            register_dock_recent,
            #[cfg(target_os = "macos")]
            pdf_export::commands::export_pdf,
            #[cfg(target_os = "macos")]
            pdf_export::commands::print_document,
            pandoc::commands::detect_pandoc,
            pandoc::commands::export_via_pandoc,
            content_search::search_workspace_content,
            content_server::commands::content_server_start,
            content_server::commands::content_server_stop,
            content_server::commands::content_server_status,
            content_server::commands::content_server_browser_url,
            content_server::commands::content_server_graph,
            content_server::slidev_commands::content_server_slidev_preview,
            content_server::slidev_commands::content_server_slidev_export,
            pty::pty_spawn,
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_close,
            pty::pty_pause,
            pty::pty_resume,
            shell_integration::prepare_shell_integration,
        ])
        .setup(setup_app)
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings) should close normally
        .on_window_event(handle_document_window_close_event);

    // Tauri MCP bridge plugin for automation/screenshots (dev only).
    //
    // Pin a dedicated base port (9323) and bind localhost-only. Without this,
    // the plugin defaults to scanning up from 0.0.0.0:9223 — the same port
    // VMark's *own* MCP server (mcp_bridge, for AI clients) already uses. The
    // two then race for 9223, so the automation bridge slides to a different,
    // unpredictable port on every launch and `tauri_driver_session` (which
    // defaults to 9223) lands on VMark's auth-protected server instead — every
    // command then drops with "Connection closed". A separate base port keeps
    // the automation channel deterministic and clear of the public MCP port.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .base_port(9323)
                .build(),
        );
    }

    // CRITICAL: Use .build().run() pattern for app-level event handling
    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(e) => {
            log::error!("fatal: failed to build tauri application: {e}");
            std::process::exit(1);
        }
    };
    app.run(handle_run_event);
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
