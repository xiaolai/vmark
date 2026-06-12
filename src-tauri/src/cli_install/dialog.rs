//! CLI-install menu action: toggles the `/usr/local/bin/vmark` shell command
//! and shows a localized result dialog. Extracted from `menu_events` so that
//! grab-bag dispatcher stays under its size baseline (audit 20260612).

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::{
    cli_install, cli_install_status, cli_uninstall, CliCommandOutcome, CliInstallError, CLI_PATH,
};

/// Install the CLI if absent, uninstall if present, then show a localized
/// result dialog. The blocking osascript flow runs off the UI thread, wrapped
/// in `spawn_logged` so a panic surfaces instead of silently swallowing
/// user feedback.
pub fn run_install_toggle(app: AppHandle) {
    crate::task::spawn_logged("menu-cli-install", async move {
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
    });
}
