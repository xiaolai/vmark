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
mod atomic_replace;
mod browser; // WI-1.2 embedded-browser surface (pure lifecycle/identity core landed)
pub mod coherence;
pub mod command_error; // WI-14 crate-wide typed command error ({code, message, i18nKey?, detail?})
mod content_search;
mod content_server;
mod external_editor;
mod file_open;
mod file_ops;
mod file_tree;
mod file_write;
mod fs_scope;
pub mod genies;
mod gha_workflow;
mod hot_exit;
mod live_docs;
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
mod secret_token;
mod secure_store;
mod shell_env;
mod shell_integration;
mod supported_files;
mod tab_transfer;
mod task;
mod temp_html;
mod trusted_html; // #1273 opt-in origin-isolated execution for standalone HTML
mod watcher;
mod webview_edit;
mod window_manager;
pub mod workflow;
mod workspace;
mod workspace_transfer;
mod workspace_validation;

#[cfg(target_os = "macos")]
mod app_nap;
#[cfg(target_os = "macos")]
mod cli_install;
#[cfg(target_os = "macos")]
mod dock_recent;
#[cfg(target_os = "macos")]
mod macos_menu;
// `pub` for the `pdf_smoke` example, which is the only harness that can
// exercise the native renderers: `cargo test` cannot host them on Windows
// (Tauri's test feature is excluded there) and MockRuntime makes
// `with_webview` a no-op, so it would prove nothing where it does link.
pub mod pdf_export;
#[cfg(target_os = "macos")]
mod text_substitution;
mod window_status;

// Crate-wide re-exports: existing `crate::` call sites (post lib.rs split).
pub use file_open::PendingFileOpen;
pub(crate) use fs_scope::allow_fs_read;
pub(crate) use supported_files::is_openable_supported;
// macOS-gated: sole consumer (quarantine sweep) is macOS-only, so an unconditional re-export is an unused-import error on Linux/Windows CI (guarded by lib.test.rs).
#[cfg(target_os = "macos")]
pub(crate) use supported_files::has_supported_extension;
#[cfg(test)]
#[path = "lib.test.rs"]
mod lib_test;

// Capability files are data, not code, and nothing else reads them at build
// time — so their contract is pinned here (#1202).
#[cfg(test)]
#[path = "capabilities.test.rs"]
mod capabilities_test;

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
                // Exclude VISIBLE from state restoration: a window saved while
                // hidden must not be restored hidden, with no way to reach it.
                // NOTE: windows are NOT created hidden — this comment used to
                // say they were, and that they are shown on the frontend's
                // "ready" event. Neither is true (see window_manager::
                // document_windows' module doc); dropping the flag is still
                // correct, but it is not part of an anti-flash mechanism.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        // Fail-closed: `engine_enabled` starts false and the webview pushes the
        // real value via `workflow_engine_policy` (WI-19).
        .manage(workflow::state::WorkflowRunnerState::default())
        // WI-20: the MCP bridge's tables, shutdown signal, write lock and
        // liveness flag, and the hot-exit pending-restore map — both were
        // process-global statics.
        .manage(mcp_bridge::McpBridgeState::default())
        .manage(hot_exit::HotExitState::default())
        .manage(content_server::ContentServerManager::new())
        .manage(browser::surface::BrowserSurface::default())
        .manage(window_status::WindowStatusRegistry::default())
        // #1273: documents the user explicitly authorized to execute. Memory
        // only — a grant never survives the process.
        .manage(trusted_html::TrustedHtmlState::default())
        // Serves those grants under their OWN CSP. A srcdoc/blob/data frame
        // inherits the app's `script-src 'self'` and can never run a script,
        // so trusted content needs an origin of its own.
        .register_uri_scheme_protocol(trusted_html::protocol::SCHEME, |ctx, request| {
            use tauri::Manager;
            // try_state, not state: this runs on the webview's protocol thread,
            // where a panic takes the app down. A missing registry should be
            // impossible — it is managed two lines above — and if it ever
            // happens, a 404 is the fail-closed answer.
            match ctx
                .app_handle()
                .try_state::<trusted_html::TrustedHtmlState>()
            {
                Some(state) => trusted_html::protocol::handle(&state, &request),
                None => trusted_html::protocol::refuse(),
            }
        })
        .invoke_handler(crate::all_commands!())
        .setup(app_setup::setup_app)
        .on_menu_event(menu_events::handle_menu_event)
        // CRITICAL: Only intercept close for document windows (main, doc-*)
        // Non-document windows (settings) should close normally
        .on_window_event(window_manager::handle_document_window_close_event);

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
