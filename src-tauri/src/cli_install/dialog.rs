//! CLI-install menu action: toggles the `/usr/local/bin/vmark` shell command
//! and shows a localized result dialog. Extracted from `menu_events` so that
//! grab-bag dispatcher stays under its size baseline (audit 20260612).

use futures_util::FutureExt;
use std::panic::AssertUnwindSafe;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::{
    cli_install, cli_install_status, cli_uninstall, CliCommandOutcome, CliInstallError, CLI_PATH,
};

/// Install the CLI if absent, uninstall if present, then show a localized
/// result dialog. The blocking osascript flow runs off the UI thread.
///
/// Spawns via `tauri::async_runtime::spawn`, **not** `tokio::spawn` / the
/// `task::spawn_logged` wrapper. This function is called directly from the
/// synchronous menu-event handler, which runs on the macOS main thread with no
/// tokio runtime context entered. A bare `tokio::spawn` there panics with "no
/// reactor running"; because the menu callback is an Objective-C FFI boundary,
/// the panic cannot unwind and aborts the whole process (SIGABRT) — issue
/// #1030. `tauri::async_runtime::spawn` uses Tauri's managed runtime handle and
/// works from any thread. The body is wrapped in `catch_unwind` so an inner
/// panic is still logged instead of silently swallowed.
pub fn run_install_toggle(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let work = async move {
            let result: Result<CliCommandOutcome, String> =
                tauri::async_runtime::spawn_blocking(|| {
                    let status = cli_install_status()?;
                    if status.foreign {
                        return Err(CliInstallError::ForeignFile.into());
                    }
                    if status.installed {
                        cli_uninstall()
                    } else {
                        cli_install()
                    }
                })
                .await
                .unwrap_or_else(|e| Err(format!("Task failed: {}", e)));

            // Localize the dialog from the structured outcome rather than
            // string-matching English Ok messages (audit 20260612 deferred).
            let title = rust_i18n::t!("cli.dialogTitle").to_string();
            match result {
                Ok(outcome) => {
                    let display = match outcome {
                        CliCommandOutcome::Installed => format!(
                            "{}\n\n{}",
                            rust_i18n::t!("cli.installed", path = CLI_PATH),
                            rust_i18n::t!("cli.runHint")
                        ),
                        CliCommandOutcome::AlreadyInstalled => {
                            rust_i18n::t!("cli.alreadyInstalled", path = CLI_PATH).to_string()
                        }
                        CliCommandOutcome::Removed => {
                            rust_i18n::t!("cli.removed", path = CLI_PATH).to_string()
                        }
                        CliCommandOutcome::NotInstalled => {
                            rust_i18n::t!("cli.notInstalled").to_string()
                        }
                    };
                    app.dialog().message(display).title(title).blocking_show();
                }
                Err(e) => {
                    // Don't show a dialog when the user cancelled the admin prompt.
                    if e != CliInstallError::Cancelled.to_string() {
                        app.dialog().message(e).title(title).blocking_show();
                    }
                }
            }
        };

        // Preserve the structured panic visibility that `task::spawn_logged`
        // gave us, without depending on an ambient tokio runtime to spawn.
        if let Err(payload) = AssertUnwindSafe(work).catch_unwind().await {
            log::error!(
                "[task:menu-cli-install] background task panicked: {}",
                crate::task::panic_payload_message(&payload)
            );
        }
    });
}
