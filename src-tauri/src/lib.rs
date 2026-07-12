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

mod ai_provider;
mod app_paths;
mod app_setup;
mod asset_access;
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
mod browser; // WI-1.2 embedded-browser surface (pure lifecycle/identity core landed)
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
// macOS-gated: sole consumer (quarantine sweep) is macOS-only; unconditional
// re-export = unused-import error on Linux/Windows CI (guarded by lib.test.rs).
#[cfg(target_os = "macos")]
pub(crate) use supported_files::has_supported_extension;
#[cfg(test)]
#[path = "lib.test.rs"]
mod lib_test;

/// Debug logging from frontend (logs to terminal, debug builds only)
#[cfg(debug_assertions)]
#[tauri::command]
fn debug_log(message: String) {
    log::debug!("[Frontend] {}", message);
}

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
        .invoke_handler(tauri::generate_handler![
            window_status::report_window_status,
            window_status::set_window_attention,
            window_status::clear_window_attention,
            window_status::get_window_statuses,
            window_status::focus_window,
            file_open::get_pending_file_opens,
            asset_access::grant_asset_access,
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
            shell_env::get_default_shell,
            shell_env::get_login_shell_path,
            shell_env::list_available_shells,
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
            temp_html::write_temp_html,
            file_write::atomic_write_file,
            webview_edit::trigger_webview_edit,
            browser::commands::browser_create,
            browser::commands::browser_navigate,
            browser::commands::browser_set_bounds,
            browser::commands::browser_destroy,
            browser::commands::browser_assert_no_bridge,
            #[cfg(target_os = "macos")]
            dock_recent::register_dock_recent,
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
