//! # VMark Tauri Application
//!
//! Purpose: Entry point for the Tauri backend — wires together all modules,
//! registers commands, configures plugins, and handles app-level events.
//!
//! Pipeline: `main.rs` → `run()` here → Tauri builder (log plugin first, then others)
//!   → window creation → frontend
//!
//! Key decisions:
//!   - Window close is intercepted for document windows (main, doc-*) to allow
//!     dirty-document prompts; non-document windows close immediately.
//!   - File opens from Finder are queued in `PENDING_FILE_OPENS` until the frontend
//!     signals readiness, solving a cold-start race condition. Only .md/.markdown
//!     files are accepted; other extensions are skipped. Hot opens (app already
//!     running) use `app.emit()` (global broadcast) — NOT `window.emit()` — so the
//!     frontend's global `listen()` in `useFinderFileOpen` receives them. Tauri v2
//!     webview-specific events are not delivered to global `listen()`.
//!   - macOS Reopen event (dock click) creates a new main window when none visible.
//!   - Default shell resolved via `getpwuid_r` → `$SHELL` → `/bin/sh` (reliable in
//!     GUI apps). Available shells detected from `/etc/shells` (Unix) or `where.exe`
//!     (Windows), always returning absolute paths.
//!   - `machine_id_hash()` generates a stable anonymous device identifier via
//!     SHA-256(hostname + OS + arch), sent as `X-Machine-Id` header on update checks.
//!
//! Known limitations:
//!   - ExitRequested handling must carefully distinguish OS quit from user quit
//!     to avoid premature exit during coordinated quit flow.

rust_i18n::i18n!("locales", fallback = "en");

mod ai_provider;
mod app_paths;
mod mcp_bridge;
mod mcp_config;
mod mcp_server;
mod menu;
mod menu_events;
mod genies;
mod quit;
mod watcher;
mod window_manager;
mod workspace;
mod content_search;
mod file_ops;
mod file_tree;
mod pty;
mod hot_exit;
mod pandoc;
mod tab_transfer;
mod workflow;
mod gha_workflow;
mod quarantine;
mod external_editor;

#[cfg(target_os = "macos")]
mod app_nap;
#[cfg(target_os = "macos")]
mod macos_menu;
#[cfg(target_os = "macos")]
mod dock_recent;
#[cfg(target_os = "macos")]
mod cli_install;
#[cfg(target_os = "macos")]
mod pdf_export;

use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
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

static PENDING_FILE_OPENS: Mutex<Vec<PendingFileOpen>> = Mutex::new(Vec::new());

/// Tracks whether frontend has initialized (called get_pending_file_opens)
/// After this, file opens should emit events instead of queueing
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// Get and clear pending file opens - called by frontend when ready
/// Also marks frontend as ready so future file opens emit events
#[tauri::command]
fn get_pending_file_opens() -> Vec<PendingFileOpen> {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    let mut pending = PENDING_FILE_OPENS.lock().unwrap_or_else(|p| p.into_inner());
    pending.drain(..).collect()
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
    "md", "markdown", "mdown", "mkd", "mdx",
    // Plain text
    "txt",
    // Phase 2 data formats
    "json", "jsonl", "yaml", "yml", "toml",
    // Phase 3 visual-render formats
    "mmd", "svg", "html", "htm",
    // Phase 4 code viewers
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
            SUPPORTED_EXTENSIONS.iter().any(|allowed| *allowed == lowered)
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

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data.join("temp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Clean up stale temp files (older than 1 hour)
    cleanup_stale_temp_files(&dir);

    // Use tempfile for kernel-guaranteed unique filename (no PID+time guessability)
    let mut temp = tempfile::Builder::new()
        .prefix("vmark-export-")
        .suffix(".html")
        .tempfile_in(&dir)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Write content first, then persist (keep on disk after handle drops)
    temp.write_all(html.as_bytes()).map_err(|e| e.to_string())?;
    let path = temp.path().to_path_buf();
    temp.persist(&path).map_err(|e| format!("Failed to persist temp file: {}", e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Remove temp HTML files older than 1 hour to prevent accumulation.
fn cleanup_stale_temp_files(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
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
    if target.components().any(|c| c == std::path::Component::ParentDir) {
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

    let mut tmp = NamedTempFile::new_in(dir)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

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
            .or_else(|| std::env::var("SHELL").ok().filter(|s| shell_path_is_valid(s)))
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
    let mut buf_size = if init_size > 0 { init_size as usize } else { 1024 };

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

        return if shell_str.is_empty() { None } else { Some(shell_str) };
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
    let output = ai_provider::which_command()
        .arg(name)
        .output()
        .ok()?;
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
        let user_shell = login_shell_from_passwd()
            .or_else(|| std::env::var("SHELL").ok());
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
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .into_owned();
    let input = format!(
        "vmark-machine-id-v1:{}:{}:{}",
        hostname,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
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
                .expect("valid ASCII hex header")
                .build()
        })
        .plugin(tauri_plugin_process::init())
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
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file_opens,
            external_editor::open_in_external_editor,
            menu::update_recent_files,
            menu::update_recent_workspaces,
            menu::refresh_genies_menu,
            menu::hide_genies_menu,
            menu::rebuild_menu,
            menu::update_menu_accelerators,
            menu::set_locale,
            window_manager::new_window,
            window_manager::open_file_in_new_window,
            window_manager::open_workspace_in_new_window,
            window_manager::open_workspace_with_files_in_new_window,
            window_manager::close_window,
            window_manager::force_quit,
            window_manager::request_quit,
            quit::cancel_quit,
            quit::set_confirm_quit,
            watcher::start_watching,
            watcher::stop_watching,
            file_tree::list_directory_entries,
            file_ops::get_file_size_bytes,
            workspace::open_folder_dialog,
            workspace::read_workspace_config,
            workspace::write_workspace_config,
            quarantine::strip_workspace_quarantine_cmd,
            mcp_server::mcp_bridge_start,
            mcp_server::mcp_bridge_stop,
            mcp_server::mcp_server_start,
            mcp_server::mcp_server_stop,
            mcp_server::mcp_server_status,
            mcp_server::mcp_sidecar_health,
            mcp_server::mcp_bridge_client_count,
            mcp_server::mcp_bridge_connected_clients,
            mcp_bridge::commands::mcp_bridge_respond,
            mcp_bridge::commands::mcp_bridge_heartbeat,
            mcp_config::commands::mcp_config_get_status,
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
            cli_install::cli_install_status,
            #[cfg(target_os = "macos")]
            cli_install::cli_install,
            #[cfg(target_os = "macos")]
            cli_install::cli_uninstall,
            #[cfg(target_os = "macos")]
            pdf_export::commands::export_pdf,
            #[cfg(target_os = "macos")]
            pdf_export::commands::print_document,
            pandoc::commands::detect_pandoc,
            pandoc::commands::export_via_pandoc,
            content_search::search_workspace_content,
            pty::pty_spawn,
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_close,
            pty::pty_pause,
            pty::pty_resume,
        ])
        .setup(|app| {
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
                let file_args =
                    filter_supported_args(std::env::args().skip(1));

                if !file_args.is_empty() {
                    if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                        for path_str in file_args {
                            allow_fs_read(app.handle(), &path_str);
                            let workspace_root =
                                window_manager::get_workspace_root_for_file(&path_str);
                            pending.push(PendingFileOpen {
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
        })
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings) should close normally
        .on_window_event(|window, event| {
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
        });

    // Tauri MCP bridge plugin for automation/screenshots (dev only)
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .build(),
        );
    }

    // CRITICAL: Use .build().run() pattern for app-level event handling
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // CRITICAL: Prevent quit on last window close (macOS behavior)
                // App should only quit via Cmd+Q or menu Quit
                tauri::RunEvent::ExitRequested { api, code, .. } => {
                    log::debug!("[Tauri] ExitRequested received, code={:?}", code);

                    // If we explicitly allowed exit (we're done with coordinated quit), allow it through.
                    // IMPORTANT: Quit can be "in progress" while we still need to block OS quit requests.
                    if quit::is_exit_allowed() {
                        log::debug!("[Tauri] ExitRequested: exit allowed, allowing exit");
                        return;
                    }

                    // Prevent exit for last-window-close scenario (macOS behavior)
                    api.prevent_exit();
                    log::debug!("[Tauri] ExitRequested: prevent_exit() called");

                    // Only start coordinated quit if there are document windows
                    let has_doc_windows = app
                        .webview_windows()
                        .keys()
                        .any(|label| quit::is_document_window_label(label));

                    if has_doc_windows {
                        log::debug!("[Tauri] ExitRequested: starting quit flow");
                        quit::start_quit(app);
                    }
                    // If no document windows, just stay alive (macOS dock behavior)
                }
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } => {
                    quit::handle_window_destroyed(app, &label);
                    menu_events::clear_window_ready(&label);
                    tab_transfer::clear_unclaimed_transfer(&label);
                }
                // macOS: Clicking dock icon when no windows visible -> create main window
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    if !has_visible_windows {
                        // Prefer creating a "main" window so useFinderFileOpen works.
                        // Fall back to doc-N if "main" already exists (shouldn't happen
                        // when has_visible_windows is false, but be safe).
                        if app.get_webview_window("main").is_none() {
                            // Reset readiness so any subsequent Opened events are queued
                            // until the new main window's React mounts and drains them.
                            FRONTEND_READY.store(false, Ordering::SeqCst);
                            let _ = window_manager::create_main_window(app);
                        } else {
                            let _ = window_manager::create_document_window(app, None, None);
                        }
                    }
                }
                // Handle files opened from Finder (double-click, "Open With", etc.)
                // Groups files by workspace root to open them as tabs in a single window
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    // Convert URLs to file paths, handling directories immediately
                    let mut file_paths = Vec::new();
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let Some(path_str) = path.to_str() else { continue };
                            if path.is_dir() {
                                log::info!("[Finder] Opening directory: {}", path_str);
                                let _ = window_manager::create_document_window(
                                    app, None, Some(path_str),
                                );
                                continue;
                            }
                            // Only queue markdown files — non-markdown files would
                            // create broken empty tabs (#661 audit gap 9.1).
                            // Uses the shared helper so CLI and Finder filters
                            // stay in sync — the same set of markdown
                            // extensions is accepted at every entry point.
                            if !is_openable_supported(&path) {
                                log::warn!("[Finder] Skipping non-markdown file: {}", path_str);
                                continue;
                            }
                            // Extend fs read scope so the webview's readTextFile
                            // succeeds for paths outside the static capability
                            // scope (e.g. /private/tmp). See allow_fs_read docs.
                            allow_fs_read(app, path_str);
                            file_paths.push(path_str.to_string());
                        }
                    }
                    if !file_paths.is_empty() {
                    log::info!("[Finder] Opening {} file(s)", file_paths.len());

                    let groups = window_manager::group_paths_by_workspace(&file_paths);

                    for (workspace_key, paths) in groups {
                        let ws = if workspace_key.is_empty() {
                            None
                        } else {
                            Some(workspace_key.as_str())
                        };

                        let action = window_manager::determine_file_open_action(
                            FRONTEND_READY.load(Ordering::SeqCst),
                            app.get_webview_window("main").is_some(),
                        );

                        match action {
                            window_manager::FileOpenAction::EmitToMainWindow => {
                                use tauri::Emitter;
                                log::info!("[Finder] Emitting to main window");
                                // Use app.emit() (global broadcast) so the frontend's
                                // global listen() in useFinderFileOpen receives it.
                                // window.emit() sends a webview-specific event that is
                                // NOT delivered to @tauri-apps/api/event listen() —
                                // only to currentWindow.listen() — so the hook would
                                // silently miss every hot open.
                                if app.get_webview_window("main").is_some() {
                                    for path in &paths {
                                        let payload = PendingFileOpen {
                                            path: path.clone(),
                                            workspace_root: ws.map(String::from),
                                        };
                                        if let Err(e) = app.emit("app:open-file", payload) {
                                            // Emit failed — fallback to queue so the file isn't lost
                                            log::warn!("[Finder] emit failed, queueing: {e}");
                                            FRONTEND_READY.store(false, Ordering::SeqCst);
                                            if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                                window_manager::queue_pending_file_opens(
                                                    &mut pending, paths, ws,
                                                );
                                            }
                                            break;
                                        }
                                    }
                                } else {
                                    // Window disappeared between decision and emit — queue and create
                                    FRONTEND_READY.store(false, Ordering::SeqCst);
                                    if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                        window_manager::queue_pending_file_opens(
                                            &mut pending, paths, ws,
                                        );
                                    }
                                    let _ = window_manager::create_main_window(app);
                                }
                            }
                            window_manager::FileOpenAction::QueueAndCreateWindow => {
                                log::info!("[Finder] Queueing files, creating main window");
                                FRONTEND_READY.store(false, Ordering::SeqCst);
                                if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                    window_manager::queue_pending_file_opens(
                                        &mut pending, paths, ws,
                                    );
                                }
                                let _ = window_manager::create_main_window(app);
                            }
                            window_manager::FileOpenAction::QueueOnly => {
                                log::info!("[Finder] Queueing files (frontend not ready)");
                                if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                    window_manager::queue_pending_file_opens(
                                        &mut pending, paths, ws,
                                    );
                                }
                            }
                        }
                    }
                    } // if !file_paths.is_empty()
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_write_file_sync, filter_supported_args, has_supported_extension, is_openable_supported,
        MARKDOWN_ONLY_EXTENSIONS, SUPPORTED_EXTENSIONS, PARENT_MISSING_ERROR_PREFIX,
    };
    use std::path::{Path, PathBuf};

    // -- SUPPORTED_EXTENSIONS constant ----------------------------------------

    #[test]
    fn supported_extensions_cover_phase1a_set() {
        // Freezes the Phase 1A accepted set — if this list changes, every
        // entry point (CLI args, Finder RunEvent::Opened,
        // open_*_in_new_window commands, `dialog:allow-open` filters,
        // `validate_openable_path`, the macOS quarantine strip pass)
        // must be audited for consistency. The TS side is verified by
        // `scripts/check-ext-sync.sh` (ADR-12).
        assert!(SUPPORTED_EXTENSIONS.contains(&"md"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"txt"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"json"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"yaml"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"toml"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"html"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"ts"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"py"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"rs"));
        // Strict markdown subset is still available for narrow callers.
        assert_eq!(
            MARKDOWN_ONLY_EXTENSIONS,
            &["md", "markdown", "mdown", "mkd", "mdx"],
        );
    }

    // -- has_supported_extension ----------------------------------------------

    #[test]
    fn accepts_every_markdown_extension() {
        for ext in SUPPORTED_EXTENSIONS {
            let path = PathBuf::from(format!("/some/file.{ext}"));
            assert!(
                has_supported_extension(&path),
                "expected '.{ext}' to be accepted",
            );
        }
    }

    #[test]
    fn accepts_uppercase_and_mixed_case_extensions() {
        assert!(has_supported_extension(Path::new("/a/NOTE.MD")));
        assert!(has_supported_extension(Path::new("/a/note.Md")));
        assert!(has_supported_extension(Path::new("/a/Readme.MARKDOWN")));
    }

    #[test]
    fn rejects_unregistered_extensions() {
        assert!(!has_supported_extension(Path::new("/a/image.png")));
        assert!(!has_supported_extension(Path::new("/a/video.mp4")));
        // `.md.bak` resolves to extension `bak`, which is not registered.
        assert!(!has_supported_extension(Path::new("/a/note.md.bak")));
    }

    #[test]
    fn accepts_phase1a_non_markdown_extensions() {
        // Phase 1B verification: txt, json, yaml etc. now pass.
        assert!(has_supported_extension(Path::new("/a/notes.txt")));
        assert!(has_supported_extension(Path::new("/a/data.json")));
        assert!(has_supported_extension(Path::new("/a/config.yaml")));
        assert!(has_supported_extension(Path::new("/a/Cargo.toml")));
        assert!(has_supported_extension(Path::new("/a/page.html")));
    }

    #[test]
    fn rejects_path_without_extension() {
        assert!(!has_supported_extension(Path::new("/a/README")));
        assert!(!has_supported_extension(Path::new("/a/.hiddenrc")));
    }

    #[test]
    fn rejects_empty_path() {
        assert!(!has_supported_extension(Path::new("")));
    }

    // -- is_openable_supported (requires real filesystem) ---------------------

    #[test]
    fn rejects_missing_path() {
        let missing = PathBuf::from("/definitely/does/not/exist-vmark-test.md");
        assert!(!is_openable_supported(&missing));
    }

    #[test]
    fn rejects_directory_even_with_markdown_name() {
        // Build a temp directory whose name ends in .md — the extension
        // check alone would pass, so this proves is_file() is consulted.
        let dir = tempfile::tempdir().expect("create tempdir");
        let md_dir = dir.path().join("looks-like-note.md");
        std::fs::create_dir(&md_dir).expect("create subdir");
        assert!(!is_openable_supported(&md_dir));
    }

    #[test]
    fn accepts_existing_markdown_file() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let file_path = dir.path().join("note.MD");
        std::fs::write(&file_path, b"# hi").expect("write temp file");
        assert!(is_openable_supported(&file_path));
    }

    #[test]
    fn rejects_existing_unregistered_file() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let file_path = dir.path().join("photo.png");
        std::fs::write(&file_path, b"\x89PNG").expect("write temp file");
        assert!(!is_openable_supported(&file_path));
    }

    #[test]
    fn accepts_existing_phase1a_files() {
        let dir = tempfile::tempdir().expect("create tempdir");
        for ext in ["txt", "json", "yaml", "toml", "html"] {
            let file_path = dir.path().join(format!("file.{ext}"));
            std::fs::write(&file_path, b"data").expect("write");
            assert!(
                is_openable_supported(&file_path),
                ".{ext} file should pass"
            );
        }
    }

    // -- filter_supported_args -------------------------------------------------
    // Covers the Windows/Linux CLI entry point. macOS Finder
    // (RunEvent::Opened) and the `open_*_in_new_window` commands go through
    // the same `is_openable_supported` gate, so the acceptance policy is
    // uniform across all three surfaces.

    #[test]
    fn cli_filter_keeps_every_supported_variant() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let mut inputs = Vec::new();
        for ext in SUPPORTED_EXTENSIONS {
            let path = dir.path().join(format!("note.{ext}"));
            std::fs::write(&path, b"# hi").expect("write");
            inputs.push(path.to_string_lossy().into_owned());
        }
        let kept = filter_supported_args(inputs.clone());
        assert_eq!(kept, inputs, "every supported extension should pass");
    }

    #[test]
    fn cli_filter_drops_unregistered_and_missing_and_directory() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let good = dir.path().join("keep.md");
        std::fs::write(&good, b"# hi").expect("write good");

        let unregistered = dir.path().join("drop.png");
        std::fs::write(&unregistered, b"png").expect("write unregistered");

        let md_dir = dir.path().join("looks-markdown.md");
        std::fs::create_dir(&md_dir).expect("mkdir");

        let missing = dir.path().join("vanished.md");

        let inputs = vec![
            good.to_string_lossy().into_owned(),
            unregistered.to_string_lossy().into_owned(),
            md_dir.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ];

        let kept = filter_supported_args(inputs);
        assert_eq!(kept, vec![good.to_string_lossy().into_owned()]);
    }

    #[test]
    fn cli_filter_empty_input_returns_empty() {
        let kept = filter_supported_args(Vec::<String>::new());
        assert!(kept.is_empty());
    }

    // -- parity across entry points ------------------------------------------

    #[test]
    fn finder_and_cli_share_acceptance_policy() {
        // The Finder RunEvent::Opened handler uses `is_openable_supported`
        // directly (lib.rs `tauri::RunEvent::Opened` arm). The CLI filter
        // routes through the same predicate via filter_supported_args. This
        // test pins that invariant — if either surface diverges, this
        // fails loudly rather than letting drift recur silently.
        let dir = tempfile::tempdir().expect("create tempdir");
        let file = dir.path().join("note.MD");
        std::fs::write(&file, b"# hi").expect("write");
        let raw = file.to_string_lossy().into_owned();

        // Finder path (the predicate called inside RunEvent::Opened)
        let finder_accepts = is_openable_supported(&file);
        // CLI path (the wrapper used in the setup closure)
        let cli_accepts = !filter_supported_args(vec![raw.clone()]).is_empty();

        assert!(finder_accepts, "finder arm must accept note.MD");
        assert!(cli_accepts, "cli arm must accept note.MD");
        assert_eq!(finder_accepts, cli_accepts);
    }

    // -- allow_fs_read runtime scope extension (mock Tauri app) --------------
    //
    // Covers the wiring that the CLI, Finder, and `open_*_in_new_window`
    // entry points all rely on: calling `allow_fs_read(app, path)` must
    // mutate the fs plugin's scope so `readTextFile(path)` in the webview
    // later succeeds. Without this, the bug reported in #676 recurs
    // silently — validators pass, but the webview read is still denied.

    // tauri::test::MockRuntime crashes the test binary at startup on
    // windows-latest (STATUS_ENTRYPOINT_NOT_FOUND). The `test` feature of
    // tauri is not enabled on Windows (see Cargo.toml target-specific
    // dev-dependency), and these tests are cfg-gated to match. macOS/Linux
    // still exercise the scope-extension wiring end-to-end.
    #[cfg(not(target_os = "windows"))]
    use super::allow_fs_read;
    #[cfg(not(target_os = "windows"))]
    use tauri_plugin_fs::FsExt;

    #[cfg(not(target_os = "windows"))]
    fn mock_app_with_fs() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app with fs plugin")
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn allow_fs_read_extends_scope_so_read_is_permitted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("note.md");
        std::fs::write(&file, b"# hi").expect("write");

        let app = mock_app_with_fs();
        // Sanity: a fresh mock scope does NOT already allow this arbitrary
        // path. If this flips, the rest of the test is meaningless.
        assert!(
            !app.fs_scope().is_allowed(&file),
            "mock fs scope should reject unknown path before extension"
        );

        allow_fs_read(app.handle(), file.to_str().unwrap());

        assert!(
            app.fs_scope().is_allowed(&file),
            "allow_fs_read should extend scope so the webview can read the path"
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn allow_fs_read_is_idempotent() {
        // Calling twice must not panic, error, or double-allow in a way
        // that breaks subsequent reads. The Finder cold-start path does
        // this when a file arrives via both the pending queue and a later
        // hot event.
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("note.md");
        std::fs::write(&file, b"# hi").expect("write");

        let app = mock_app_with_fs();
        allow_fs_read(app.handle(), file.to_str().unwrap());
        allow_fs_read(app.handle(), file.to_str().unwrap());

        assert!(app.fs_scope().is_allowed(&file));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn allow_fs_read_does_not_grant_unrelated_paths() {
        // Extending scope for one file must not leak into neighbors.
        let dir = tempfile::tempdir().expect("tempdir");
        let allowed = dir.path().join("keep.md");
        let other = dir.path().join("other.md");
        std::fs::write(&allowed, b"# hi").expect("write allowed");
        std::fs::write(&other, b"# hi").expect("write other");

        let app = mock_app_with_fs();
        allow_fs_read(app.handle(), allowed.to_str().unwrap());

        assert!(app.fs_scope().is_allowed(&allowed));
        assert!(
            !app.fs_scope().is_allowed(&other),
            "scope extension must be per-file, not per-directory"
        );
    }

    // -- atomic_write_file_sync ----------------------------------------------

    #[test]
    fn atomic_write_succeeds_when_parent_dir_exists() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let target = dir.path().join("note.md");

        atomic_write_file_sync(&target, "hello").expect("write should succeed");

        let read_back = std::fs::read_to_string(&target).expect("read back");
        assert_eq!(read_back, "hello");
    }

    #[test]
    fn atomic_write_returns_parent_missing_sentinel_when_dir_gone() {
        // Regression test: if the parent directory was renamed/deleted
        // between open and save, `NamedTempFile::new_in` would fail with a
        // raw "No such file or directory (os error 2)". Our explicit
        // pre-flight check converts that to a recognizable sentinel so the
        // frontend can route into Save As instead of leaking the OS error.
        let dir = tempfile::tempdir().expect("create tempdir");
        let gone = dir.path().join("renamed-away");
        let target = gone.join("note.md");
        // gone/ is intentionally never created — the parent does not exist.

        let err = atomic_write_file_sync(&target, "hello")
            .expect_err("write must fail when parent dir is missing");

        assert!(
            err.starts_with(PARENT_MISSING_ERROR_PREFIX),
            "expected sentinel prefix, got: {err}",
        );
        assert!(
            err.contains("renamed-away"),
            "expected missing dir path in error, got: {err}",
        );
        // Belt-and-suspenders: ensure we did NOT leak the raw OS error.
        assert!(
            !err.contains("os error 2"),
            "raw OS error must not leak when parent is missing, got: {err}",
        );
    }

    #[test]
    fn atomic_write_returns_parent_missing_when_parent_is_a_file() {
        // Edge case: parent path exists but isn't a directory (someone
        // replaced the folder with a file of the same name).
        let dir = tempfile::tempdir().expect("create tempdir");
        let parent_as_file = dir.path().join("not-a-dir");
        std::fs::write(&parent_as_file, b"oops").expect("create file");
        let target = parent_as_file.join("note.md");

        let err = atomic_write_file_sync(&target, "hello")
            .expect_err("write must fail when parent is a file, not a dir");
        assert!(err.starts_with(PARENT_MISSING_ERROR_PREFIX), "got: {err}");
    }
}
