//! What `pty_spawn` will run on the webview's behalf.
//!
//! Purpose: the webview names the shell, its arguments and its environment.
//! Taken as given, that is "run any binary with any arguments and any
//! environment" for whoever controls the webview — a wider door than a
//! terminal needs. This module narrows it to what the terminal actually sends.
//!
//! Key decisions:
//!   - The shell must be one VMark itself offers: the default shell, or an
//!     entry of the list the settings page shows. The default is compared
//!     first, so the common case never pays for the list (on Windows it runs
//!     `where.exe`).
//!   - Arguments are not free-form. The only ones a spawn may carry are those
//!     shell integration produces for that shell (`--rcfile <rc>` for bash,
//!     none for zsh). They are asked of it rather than restated here, so the
//!     two cannot drift — and only after the shell passed, because preparing
//!     integration may itself run the shell.
//!   - Environment keys come from a closed list: exactly the keys the frontend
//!     sets. Values are not judged.
//!   - A request outside the policy is refused, never trimmed to fit. A
//!     frontend that starts sending something new must fail loudly.
//!   - `VettedCommand` can only be built here, so `create_session` cannot be
//!     reached with a command that skipped the policy.
//!
//! @coordinates-with pty.rs — `pty_spawn` vets before it spawns
//! @coordinates-with pty/session.rs — `create_session` takes a `VettedCommand`
//! @coordinates-with src/components/Terminal/terminalSpawnEnv.ts — the env keys and args the frontend sends
//! @coordinates-with shell_integration.rs — source of the allowed arguments
//! @coordinates-with shell_env.rs — source of the allowed shells
//! @module pty/spawn_policy

use crate::command_error::CommandError;
use portable_pty::CommandBuilder;
use std::collections::BTreeMap;
use std::path::Path;

/// Every environment key a terminal spawn may set. The base environment is
/// `buildBaseTerminalEnv` (`TERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`,
/// `COLORTERM`, `PATH`, `LC_CTYPE`, `VMARK_WORKSPACE`); `spawnPty` adds the
/// transcript token; zsh shell integration adds the two `ZDOTDIR` keys.
/// `scripts/pty-spawn-env-keys.test.mjs` holds this list equal to the keys
/// the frontend and shell integration actually set.
const ALLOWED_ENV_KEYS: [&str; 10] = [
    "COLORTERM",
    "LC_CTYPE",
    "PATH",
    "TERM",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "USER_ZDOTDIR",
    "VMARK_TRANSCRIPT_TOKEN",
    "VMARK_WORKSPACE",
    "ZDOTDIR",
];

/// Where the allowed shells come from. `listed` is only called when the
/// requested shell is not the default one.
pub(super) struct ShellSource<L> {
    pub(super) default_shell: String,
    pub(super) listed: L,
}

impl ShellSource<fn() -> Vec<String>> {
    /// The shells this machine offers, as the settings page sees them.
    pub(super) fn system() -> Self {
        Self {
            default_shell: crate::shell_env::default_shell(),
            listed: crate::shell_env::available_shells,
        }
    }
}

/// A command the policy accepted.
pub(super) struct VettedCommand {
    file: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
}

impl VettedCommand {
    pub(super) fn file(&self) -> &str {
        &self.file
    }

    /// The command to hand the PTY, started in `cwd` when one is given.
    pub(super) fn into_builder(self, cwd: Option<&str>) -> CommandBuilder {
        let mut builder = CommandBuilder::new(&self.file);
        builder.args(&self.args);
        if let Some(cwd) = cwd {
            builder.cwd(cwd);
        }
        for (key, value) in &self.env {
            builder.env(key, value);
        }
        builder
    }

    /// Test fixtures run scripts no policy would accept.
    #[cfg(all(test, unix))]
    pub(super) fn unvetted(file: &str, args: &[&str]) -> Self {
        Self {
            file: file.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: BTreeMap::new(),
        }
    }
}

/// Paths on Windows compare case-insensitively, as the settings page does.
fn same_shell(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

fn refused(message: impl Into<String>) -> CommandError {
    CommandError::permission_denied(message)
}

/// Accept or refuse a spawn request.
///
/// `integration_args` answers "which arguments does shell integration give
/// this shell?". It is called only for a shell that passed, and only when the
/// request carries arguments at all.
pub(super) fn vet<L: FnOnce() -> Vec<String>>(
    shells: ShellSource<L>,
    file: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    integration_args: impl FnOnce(&str) -> Result<Vec<String>, CommandError>,
) -> Result<VettedCommand, CommandError> {
    let path = Path::new(&file);
    if !path.is_absolute() {
        return Err(CommandError::invalid_input(
            "Shell must be an absolute path",
        ));
    }
    let offered = same_shell(&file, &shells.default_shell)
        || (shells.listed)()
            .iter()
            .any(|listed| same_shell(&file, listed));
    if !offered {
        return Err(refused(format!("Not a shell VMark offers: {file}")));
    }
    if !path.exists() {
        return Err(CommandError::not_found(format!("Shell not found: {file}")));
    }
    if let Some(key) = env
        .keys()
        .find(|key| !ALLOWED_ENV_KEYS.contains(&key.as_str()))
    {
        return Err(refused(format!(
            "Not an environment variable a terminal may set: {key}"
        )));
    }
    if !args.is_empty() && args != integration_args(&file)? {
        return Err(refused(
            "Shell arguments are not the ones its integration uses",
        ));
    }
    Ok(VettedCommand { file, args, env })
}

#[cfg(test)]
#[path = "spawn_policy.test.rs"]
mod tests;
