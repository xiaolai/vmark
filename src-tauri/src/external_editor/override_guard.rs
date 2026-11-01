//! Editor-override boundary guard.
//!
//! Purpose: stop `open_in_external_editor`'s `editor_override` from being a
//! process-execution primitive. The command runs `<override> <file>`; both
//! come from the webview (the override is the Settings value, sent over IPC),
//! and VMark opens `sh`/`py`/`rb`/`js` files — so an override naming an
//! interpreter or a shell does not open the file, it RUNS it.
//!
//! Key decisions:
//!   - One token, never split into a program and arguments. Arguments belong
//!     in `$VMARK_EXTERNAL_EDITOR`, which the webview cannot set.
//!   - A bare name is looked up on PATH, so it must be an editor VMark knows
//!     by name ([`KNOWN_EDITORS`]). "Any single word" is how `python3` got in.
//!   - An absolute path must exist, must not detour through `..` or end in a
//!     separator, and neither the name it is spelled with nor the name it
//!     RESOLVES to (links followed) may be something that runs its argument
//!     ([`RUNS_ITS_ARGUMENT`]). Resolving is what stops a link called `code`
//!     that points at `/bin/sh`.
//!   - Refusals the user can act on are localized; they reach a toast.
//!
//! What this does NOT enforce — the same residual `ai_provider/cli_path_guard`
//! states: it cannot tell a real editor from a program planted under an
//! innocent name, and [`RUNS_ITS_ARGUMENT`] is a list of known offenders, a
//! floor rather than a proof. Telling those apart needs to know WHO is asking,
//! which no Tauri command can.
//!
//! @coordinates-with external_editor.rs — the only caller
//! @coordinates-with ai_provider/cli_path_guard.rs — the same guard for `cli_path`
//! @module external_editor/override_guard

use std::path::Path;

use super::program_names::{KNOWN_EDITORS, RUNS_ITS_ARGUMENT};

/// Characters that never belong in an executable path or name. Nothing here
/// is handed to a shell, so they could not inject today; refusing them keeps a
/// future shell-out from becoming a hole by accident.
const FORBIDDEN: &[char] = &[
    ';', '|', '&', '`', '$', '<', '>', '\n', '\r', '\0', '"', '\'',
];

/// Suffixes that are packaging, not part of a program's name.
const NAME_SUFFIXES: &[&str] = &[".exe", ".cmd", ".bat", ".com", ".app"];

/// Validate the webview-supplied editor override.
///
/// Returns the trimmed override (`""` when blank, meaning "no override"), or
/// an `Err` saying why it was refused.
pub(super) fn validate_editor_override(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some(c) = trimmed.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(format!(
            "external editor override contains forbidden character {c:?}; \
             pick an executable path or app bundle without shell metacharacters"
        ));
    }
    // A leading `-` has no meaning for a path or a name and is the shape of
    // "interpreter inline-code" input (`-c`, `--eval`, …).
    if trimmed.starts_with('-') {
        return Err(format!(
            "external editor override must not start with '-' (looks like a \
             command-line flag). Got: {trimmed:?}"
        ));
    }
    if is_absolute(trimmed) {
        validate_absolute(trimmed)?;
    } else {
        validate_bare_name(trimmed)?;
    }
    Ok(trimmed.to_string())
}

/// True when the OS would read `path` as absolute. A leading backslash and a
/// drive letter mean that only on Windows; on POSIX they begin a relative name.
fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
        || (cfg!(windows)
            && (path.starts_with('\\') || (path.len() >= 2 && path.chars().nth(1) == Some(':'))))
}

/// A bare name: one word, no directory part, and an editor VMark knows.
fn validate_bare_name(name: &str) -> Result<(), String> {
    if name.contains(char::is_whitespace) {
        return Err(format!(
            "external editor override with whitespace must be an absolute \
             path that exists on disk (e.g. /Applications/My App.app). To \
             pass arguments, set the $VMARK_EXTERNAL_EDITOR environment \
             variable instead. Got: {name:?}"
        ));
    }
    // A relative path resolves against the app's working directory, which is
    // nothing the user chose.
    if name.contains(['/', '\\']) {
        return Err(rust_i18n::t!("errors.externalEditor.notPlainPath").to_string());
    }
    if is_known_editor(name) {
        Ok(())
    } else {
        Err(rust_i18n::t!("errors.externalEditor.unknownName", name = name).to_string())
    }
}

/// True when `name` is in [`KNOWN_EDITORS`]. On Windows the launcher suffix
/// (`code.cmd`, `Code.exe`) is ignored and case does not matter; elsewhere a
/// name is matched exactly, because `code.cmd` on POSIX is some other file.
fn is_known_editor(name: &str) -> bool {
    if cfg!(windows) {
        let lower = name.to_ascii_lowercase();
        KNOWN_EDITORS.contains(&strip_name_suffix(&lower))
    } else {
        KNOWN_EDITORS.contains(&name)
    }
}

/// An absolute path: plainly spelled, existing, and not a program that runs
/// its argument — under the name given or the name it resolves to.
fn validate_absolute(path: &str) -> Result<(), String> {
    let not_plain = || rust_i18n::t!("errors.externalEditor.notPlainPath").to_string();
    // `..` cannot hide the final name (it is resolved below), but a detour in
    // an execution path is never legitimate; a trailing separator names a
    // directory's contents, not a program or a bundle.
    if path.split(['/', '\\']).any(|segment| segment == "..") || path.ends_with(['/', '\\']) {
        return Err(not_plain());
    }
    let spelled = path.rsplit(['/', '\\']).next().unwrap_or("");
    if spelled.is_empty() || spelled == "." {
        return Err(not_plain());
    }
    // Existence blocks aiming the editor button at a path that is not there
    // yet; resolving it is also what follows links to the real program.
    let resolved = Path::new(path)
        .canonicalize()
        .map_err(|_| format!("external editor override path '{path}' does not exist"))?;
    let resolved_name = resolved.file_name().and_then(|n| n.to_str()).unwrap_or("");
    for name in [spelled, resolved_name] {
        if runs_its_argument(name) {
            return Err(
                rust_i18n::t!("errors.externalEditor.notAnEditor", name = name).to_string(),
            );
        }
    }
    Ok(())
}

/// True when a file name is a shell, an interpreter, a launcher or a terminal
/// emulator (see [`RUNS_ITS_ARGUMENT`]). Matches whole names only: case,
/// a packaging suffix (`.exe`, `.app`) and a version tail (`python3.12`,
/// `bash-5.2`) are ignored; `nodepad` and `bashful` are not `node` and `bash`.
fn runs_its_argument(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    let name = strip_name_suffix(&lower);
    let family =
        name.trim_end_matches(|c: char| c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    RUNS_ITS_ARGUMENT.contains(&name) || RUNS_ITS_ARGUMENT.contains(&family)
}

/// `name` without a trailing packaging suffix, if it has one.
fn strip_name_suffix(name: &str) -> &str {
    NAME_SUFFIXES
        .iter()
        .find_map(|suffix| name.strip_suffix(suffix))
        .unwrap_or(name)
}

#[cfg(test)]
#[path = "override_guard.test.rs"]
mod tests;
