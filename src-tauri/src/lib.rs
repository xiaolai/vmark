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
mod app_plugins;
mod app_setup;
mod asset_access;
mod atomic_persist;
mod atomic_replace;
#[cfg(debug_assertions)]
mod automation_port;
mod bounded_read;
mod browser; // WI-1.2 embedded-browser surface (pure lifecycle/identity core landed)
mod canonical_path;
pub mod coherence;
pub mod command_error; // WI-14 crate-wide typed command error ({code, message, i18nKey?, detail?})
mod content_search;
mod content_server;
mod external_editor;
mod file_open;
mod file_ops;
mod file_tree;
mod file_tree_walk;
mod file_write;
mod fs_scope;
pub mod genies;
mod gha_workflow;
mod hot_exit;
mod link_target;
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
mod session_bus;
mod shell_env;
mod shell_integration;
mod single_instance;
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

/// Register every piece of backend state the app manages (rule 50 §10).
///
/// Extracted from `run` so it can be composed onto a `mock_builder()` and
/// ASSERTED (audit #357) — this is the part of startup that fails SILENTLY. A
/// command reads its state through `State<'_, T>`/`try_state::<T>()`, so a
/// dropped `.manage()` neither fails to compile nor fails to start; it fails
/// when a user clicks. `pdf_smoke` shipped exactly that (#250).
fn manage_state<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        // Fail-closed: `engine_enabled` starts false and the webview pushes the
        // real value via `workflow_engine_policy` (WI-19).
        .manage(workflow::state::WorkflowRunnerState::default())
        // Audit #375: the streaming AI path's per-request cancel tokens, so
        // the webview's Cancel reaches the provider, not just its listener.
        .manage(ai_provider::cancel::AiPromptCancelRegistry::default())
        // WI-20: the MCP bridge's tables, shutdown signal, write lock and
        // liveness flag, and the hot-exit pending-restore map — both were
        // process-global statics.
        .manage(mcp_bridge::McpBridgeState::default())
        .manage(hot_exit::HotExitState::default())
        .manage(content_server::ContentServerManager::new())
        .manage(browser::surface::BrowserSurface::default())
        .manage(window_status::WindowStatusRegistry::default())
        // One PDF export at a time (#198, #199): the output file and the
        // export dialog's progress stream each have exactly one producer.
        .manage(pdf_export::export_gate::ExportGate::default())
        // #1273: documents the user explicitly authorized to execute. Memory
        // only — a grant never survives the process.
        .manage(trusted_html::TrustedHtmlState::default())
}

/// Build and run the Tauri application with all plugins, commands, and event handlers.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any webview input: smart dashes/quotes corrupt markdown syntax.
    #[cfg(target_os = "macos")]
    text_substitution::disable_smart_substitutions();

    let builder = app_plugins::register(tauri::Builder::default());

    let builder = manage_state(builder)
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

    let builder = app_plugins::attach_automation_bridge(builder);

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
