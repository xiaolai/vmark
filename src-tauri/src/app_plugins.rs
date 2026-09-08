//! Every plugin the app registers, and the order that order matters in.
//!
//! Purpose: split from `lib.rs` (audit 20260907 #358). `run` had grown to ~160
//! lines holding platform policy, plugin registration, state injection,
//! protocol handling, debug automation and event-loop startup in one scope, and
//! `lib.rs` had reached the 300-line cap exactly — so the composition root
//! could not absorb another line without the file-size gate refusing it. The
//! two blocks moved here are the ones with real internal structure: the
//! single-instance guard's platform policy, and the debug automation bridge's
//! port probe.
//!
//! `manage_state` deliberately stays in `lib.rs`: it is the part of startup
//! that fails SILENTLY (a dropped `.manage()` neither fails to compile nor
//! fails to start), and `lib.test.rs` asserts it against a `mock_builder()`.
//!
//! @coordinates-with lib.rs — `run`, the only caller
//! @coordinates-with automation_port.rs — the probe the debug bridge is pinned to
//! @module app_plugins

/// Register every plugin the app runs with, in the order it needs them.
///
/// Returns the builder so the caller keeps composing; nothing here reads or
/// writes managed state.
pub(crate) fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[allow(unused_mut)]
    let mut builder = builder;

    // FIRST, before every other plugin — Tauri's own guidance, and it is what
    // makes the guard cheap: a duplicate launch is turned away before this
    // process builds any state to turn away with.
    //
    // Off macOS only. macOS keeps one process per bundle identifier natively
    // and routes later opens through `RunEvent::Opened`; on Windows and Linux
    // every file-association double-click starts a fresh process that then
    // shares one localStorage and one hot-exit session with the running app
    // (#1330 — see `single_instance.rs`).
    #[cfg(not(target_os = "macos"))]
    {
        // Linux only with a session-bus address its bus library can parse: the
        // plugin's backend unwraps that parse and aborts the process at
        // startup otherwise (WI-FL6.1 — see `session_bus.rs` for the evidence;
        // `app_setup` logs the skipped guard once a logger exists). The gate
        // performs no I/O, so it cannot delay this call.
        #[cfg(target_os = "linux")]
        let guard = crate::single_instance::session_bus_present();
        #[cfg(not(target_os = "linux"))]
        let guard = true;
        if guard {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                crate::single_instance::handle_second_launch(app, argv);
            }));
        }
    }

    builder = builder
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
            let mid = crate::app_setup::machine_id_hash();
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
        );
    builder
}

/// Attach the debug-only Tauri MCP automation bridge, or explain loudly why
/// not.
///
/// Debug builds only, and a no-op in release: the plugin is a driver surface,
/// not a product feature.
#[cfg(debug_assertions)]
pub(crate) fn attach_automation_bridge(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    let mut builder = builder;
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
    //
    // "Base" is the plugin's word, not ours: it scans up to 100 ports above
    // it when 9323 is busy, and the driver is pinned to 9323 (#157). The port
    // is therefore probed first, and a busy 9323 means NO bridge and a line
    // on stderr — the plugin is never handed a base it could slide from.
    {
        use crate::automation_port::{port_is_free, AUTOMATION_BRIDGE_PORT};
        match port_is_free(AUTOMATION_BRIDGE_PORT) {
            Ok(()) => {
                builder = builder.plugin(
                    tauri_plugin_mcp_bridge::Builder::new()
                        .bind_address("127.0.0.1")
                        .base_port(AUTOMATION_BRIDGE_PORT)
                        .build(),
                );
            }
            Err(e) => {
                // The log plugin is not built yet, so stderr is the only
                // place this can be said where `tauri dev` shows it.
                eprintln!(
                    "[Tauri] automation bridge NOT started: 127.0.0.1:{AUTOMATION_BRIDGE_PORT} \
                     is busy ({e}). tauri_driver_session is pinned to that port; free it and relaunch."
                );
            }
        }
    }
    builder
}

#[cfg(not(debug_assertions))]
pub(crate) fn attach_automation_bridge(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder
}
