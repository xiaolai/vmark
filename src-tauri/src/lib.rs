//! # VMark Tauri Application
//!
//! Purpose: Tauri backend entry point — wires modules, commands, and plugins.
//!
//! Key decisions:
//!   - `lib.rs` stays a declarative composition root: setup steps and
//!     app-level event dispatch live in `app_setup`, Finder/CLI file-open
//!     queueing and fs-scope extension in `files::open`, the extension gate in
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
mod browser; // embedded-browser surface (pure lifecycle/identity core landed)
mod canonical_path;
mod close_to_tray;
pub mod coherence;
pub mod command_error; // crate-wide typed command error ({code, message, i18nKey?, detail?})
mod content_search;
mod content_server;
mod external_editor;
mod files;
mod fs_scope;
pub mod genies;
mod gha_workflow;
mod hot_exit;
mod link_target;
mod live_docs;
mod lock_policy;
mod mcp_bridge;
mod mcp_config;
mod menu;
mod pandoc;
mod peer_text;
mod pty;
mod quarantine;
mod quit;
mod secret_token;
mod secure_store;
mod session_bus;
mod shell_env;
mod shell_integration;
mod single_instance;
mod single_instance_holder;
mod supported_files;
mod system_fonts;
mod tab_transfer;
mod task;
mod temp_html;
mod terminal_transcript;
mod third_party_notices;
mod trusted_html; // #1273 opt-in origin-isolated execution for standalone HTML
mod watcher;
mod webview_edit;
mod window_manager;
pub mod workflow;
mod workspace;

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
pub use files::open::PendingFileOpen;
pub(crate) use fs_scope::allow_fs_read;
pub(crate) use supported_files::is_openable_supported;
// macOS-gated: sole consumer (quarantine sweep) is macOS-only, so an unconditional re-export is an unused-import error on Linux/Windows CI (guarded by lib.test.rs).
#[cfg(target_os = "macos")]
pub(crate) use supported_files::has_supported_extension;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "caller_identity.test.rs"]
mod caller_identity;
#[cfg(all(test, not(target_os = "windows")))]
#[path = "ipc_caller.test.rs"]
pub(crate) mod ipc_caller;
#[cfg(test)]
#[path = "lib.test.rs"]
mod lib_test;
#[cfg(test)]
#[path = "source_scan.test.rs"]
pub(crate) mod source_scan;

// Capability files are data, not code, and nothing else reads them at build
// time — so their contract is pinned here (#1202).
#[cfg(test)]
#[path = "capabilities.test.rs"]
mod capabilities_test;

/// Register every piece of backend state the app manages (rule 50 §10).
///
/// Extracted from `run` so it can be composed onto a `mock_builder()` and
/// ASSERTED — this is the part of startup that fails SILENTLY. A
/// command reads its state through `State<'_, T>`/`try_state::<T>()`, so a
/// dropped `.manage()` neither fails to compile nor fails to start; it fails
/// when a user clicks. `pdf_smoke` shipped exactly that.
fn manage_state<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        // Fail-closed: `engine_enabled` starts false and the webview pushes the
        // real value via `workflow_engine_policy`.
        .manage(workflow::state::WorkflowRunnerState::default())
        // The streaming AI path's per-request cancel tokens, so
        // the webview's Cancel reaches the provider, not just its listener.
        .manage(ai_provider::cancel::AiPromptCancelRegistry::default())
        // The MCP bridge's tables, shutdown signal, write lock and
        // liveness flag, and the hot-exit pending-restore map — both were
        // process-global statics.
        .manage(mcp_bridge::McpBridgeState::default())
        .manage(hot_exit::HotExitState::default())
        .manage(content_server::ContentServerManager::new())
        .manage(browser::surface::BrowserSurface::default())
        .manage(window_status::WindowStatusRegistry::default())
        // One PDF export at a time: the output file and the
        // export dialog's progress stream each have exactly one producer.
        .manage(pdf_export::export_gate::ExportGate::default())
        // #1273: documents the user explicitly authorized to execute. Memory
        // only — a grant never survives the process.
        .manage(trusted_html::TrustedHtmlState::default())
        // #1419: the close-to-tray preference. Starts disabled — a push from the
        // webview that has not landed leaves the old close behaviour in force.
        .manage(close_to_tray::CloseToTrayState::default())
        // WI-LX1.1: the workspace roots the user chose. Loaded from app data
        // and re-granted in `setup_app`; picks made before that are merged.
        .manage(workspace::grants::WorkspaceGrants::default())
        // Serializes terminal-transcript CLI hook configuration writes.
        .manage(terminal_transcript::TranscriptConfigState::default())
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
        .on_menu_event(menu::events::handle_menu_event)
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
