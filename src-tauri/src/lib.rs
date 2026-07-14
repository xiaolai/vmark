//! # VMark Tauri Application
//!
//! Purpose: Tauri backend entry point — wires modules, commands, and plugins.
//!
//! Key decisions:
//!   - `lib.rs` stays a declarative composition root: setup steps and
//!     app-level event dispatch live in `app_setup`, Finder/CLI file-open
//!     queueing and fs-scope extension in `file_open`, the extension gate in
//!     `supported_files`, terminal shell resolution in `shell_env`, and the
//!     temp-HTML export writer in `temp_html`.
//!   - AI provider API keys persist in the OS keychain (`secure_store`),
//!     never in plaintext config.

rust_i18n::i18n!("locales", fallback = "en");

#[macro_use]
mod command_registry;
mod ai_provider;
mod app_paths;
mod app_setup;
mod asset_access;
mod browser; // WI-1.2 embedded-browser surface (pure lifecycle/identity core landed)
mod content_search;
mod content_server;
mod external_editor;
mod file_open;
mod file_ops;
mod file_tree;
mod file_write;
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
mod shell_env;
mod shell_integration;
mod supported_files;
mod tab_transfer;
mod task;
mod temp_html;
mod watcher;
mod webview_edit;
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
#[cfg(target_os = "macos")]
mod text_substitution;
mod window_status;

// Crate-wide re-exports: existing `crate::` call sites (post lib.rs split).
pub(crate) use file_open::allow_fs_read;
pub use file_open::PendingFileOpen;
pub(crate) use supported_files::is_openable_supported;
// macOS-gated: sole consumer (quarantine sweep) is macOS-only, so an unconditional re-export is an unused-import error on Linux/Windows CI (guarded by lib.test.rs).
#[cfg(target_os = "macos")]
pub(crate) use supported_files::has_supported_extension;
#[cfg(test)]
#[path = "lib.test.rs"]
mod lib_test;

/// Build and run the Tauri application with all plugins, commands, and event handlers.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any webview input: smart dashes/quotes corrupt markdown syntax.
    #[cfg(target_os = "macos")]
    text_substitution::disable_smart_substitutions();

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
            let mid = app_setup::machine_id_hash();
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
        .manage(browser::surface::BrowserSurface::default())
        .manage(window_status::WindowStatusRegistry::default())
        .invoke_handler(crate::all_commands!())
        .setup(app_setup::setup_app)
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings) should close normally
        .on_window_event(app_setup::handle_document_window_close_event);

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
    app.run(app_setup::handle_run_event);
}
