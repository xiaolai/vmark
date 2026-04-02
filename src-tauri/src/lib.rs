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
//!     signals readiness, solving a cold-start race condition.
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
mod file_tree;
mod hot_exit;
mod pandoc;
mod tab_transfer;
mod workflow;

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
        return Err("HTML content too large (>50 MB)".to_string());
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
        use std::io::Write;
        use tempfile::NamedTempFile;

        let target = std::path::Path::new(&path);
        let dir = target.parent().ok_or("File path has no parent directory")?;

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
        .plugin(tauri_plugin_pty::init())
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
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file_opens,
            menu::update_recent_files,
            menu::update_recent_workspaces,
            menu::refresh_genies_menu,
            menu::hide_genies_menu,
            menu::rebuild_menu,
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
            workspace::open_folder_dialog,
            workspace::read_workspace_config,
            workspace::write_workspace_config,
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
        ])
        .setup(|app| {
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
                let md_extensions = ["md", "markdown", "mdown", "mkd", "mdx"];
                let args: Vec<String> = std::env::args().skip(1).collect();
                let file_args: Vec<String> = args
                    .into_iter()
                    .filter(|arg| {
                        let path = std::path::Path::new(arg);
                        path.exists()
                            && path.is_file()
                            && path
                                .extension()
                                .and_then(|e| e.to_str())
                                .map(|e| md_extensions.contains(&e.to_lowercase().as_str()))
                                .unwrap_or(false)
                    })
                    .collect();

                if !file_args.is_empty() {
                    if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                        for path_str in file_args {
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
                                let _ = window_manager::create_document_window(
                                    app, None, Some(path_str),
                                );
                                continue;
                            }
                            file_paths.push(path_str.to_string());
                        }
                    }

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
                                if let Some(main_window) = app.get_webview_window("main") {
                                    for path in paths {
                                        let payload = PendingFileOpen {
                                            path,
                                            workspace_root: ws.map(String::from),
                                        };
                                        let _ = main_window.emit("app:open-file", payload);
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
                                FRONTEND_READY.store(false, Ordering::SeqCst);
                                if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                    window_manager::queue_pending_file_opens(
                                        &mut pending, paths, ws,
                                    );
                                }
                                let _ = window_manager::create_main_window(app);
                            }
                            window_manager::FileOpenAction::QueueOnly => {
                                if let Ok(mut pending) = PENDING_FILE_OPENS.lock() {
                                    window_manager::queue_pending_file_opens(
                                        &mut pending, paths, ws,
                                    );
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}
