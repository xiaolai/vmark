//! The `git` child process for the export: one repository, isolated from
//! the environment VMark was started in.
//!
//! Every invocation removes each inherited `GIT_*` variable (a launcher's
//! `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_CONFIG_*` must not redirect the export),
//! disables replace objects, terminal prompts, signing, colour and
//! signature display, and runs `git -C <folder>`, so a spawn failure means
//! the program is missing rather than the folder. The program is started
//! through `ai_provider::build_command` with the login shell's `PATH`,
//! because an app launched from the Dock inherits a minimal one.
//!
//! Durability follows the repository's own `core.fsync` policy, as for any
//! commit the user makes there: forcing `fsync` on every object measured
//! about 8 ms per write on macOS, roughly doubling a long export. A power
//! loss can therefore leave the ref and VMark's record of it apart; the
//! next export then reports a conflict rather than overwriting anything.
//!
//! @module agent_journal/git_export/git

use std::path::PathBuf;
use std::process::Stdio;

use super::error::ExportError;
use super::names::is_absolute_path_text;
use super::stdin_feed::{fed_output, start_thread, waited};
use crate::ai_provider::{build_command, login_shell_path};

/// Config every invocation carries, ahead of the subcommand.
const FIXED_CONFIG: [&str; 11] = [
    "--no-replace-objects",
    "-c",
    "commit.gpgSign=false",
    "-c",
    "i18n.commitEncoding=UTF-8",
    "-c",
    "i18n.logOutputEncoding=UTF-8",
    "-c",
    "log.showSignature=false",
    "-c",
    "color.ui=false",
];

/// Git's messages in the C locale, so one can be matched by its text.
const UNTRANSLATED: [(&str, &str); 2] = [("LC_ALL", "C"), ("LANGUAGE", "C")];

/// One repository folder and the program that operates on it.
#[derive(Debug, Clone)]
pub struct Git {
    program: String,
    path_env: Option<String>,
    dir: PathBuf,
}

impl Git {
    /// A handle without validation (tests drive `git init` through it).
    #[cfg(test)]
    pub fn new(program: &str, dir: PathBuf) -> Self {
        Self {
            program: program.to_owned(),
            path_env: None,
            dir,
        }
    }

    /// The repository containing the absolute folder `path`, using the
    /// `git` on the login shell's `PATH`.
    pub fn open(path: &str) -> Result<Self, ExportError> {
        Self::open_with("git", Some(login_shell_path()), path)
    }

    /// [`Git::open`] with an explicit program and `PATH`.
    pub fn open_with(
        program: &str,
        path_env: Option<String>,
        path: &str,
    ) -> Result<Self, ExportError> {
        if !is_absolute_path_text(path) {
            return Err(ExportError::InvalidRequest(
                "the repository folder must be an absolute path".to_owned(),
            ));
        }
        let git = Self {
            program: program.to_owned(),
            path_env,
            dir: PathBuf::from(path),
        };
        if !git.dir.is_dir() {
            return Err(ExportError::NotARepository(format!(
                "{path} is not a folder"
            )));
        }
        git.common_dir()?;
        Ok(git)
    }

    /// The folder the commands run in.
    #[cfg(test)]
    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// The absolute common Git directory: one key per repository, shared by
    /// all its worktrees. Decoded strictly and with only Git's line end
    /// removed (`path_line`), so a folder name ending in whitespace keeps
    /// its own key. Only Git's own "not a git repository" answer, read
    /// untranslated, is `NotARepository`; any other refusal (unsafe
    /// ownership, a corrupt config, a permission error) keeps Git's error.
    pub fn common_dir(&self) -> Result<String, ExportError> {
        let args = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
        let out = self.output(&args, None, &UNTRANSLATED)?;
        let not_a_repository = !out.status.success()
            && String::from_utf8_lossy(&out.stderr).contains("not a git repository");
        let raw = finish(&args, out).map_err(|e| match e {
            ExportError::Git(m) if not_a_repository => ExportError::NotARepository(m),
            other => other,
        })?;
        let text = String::from_utf8(raw)
            .map_err(|_| ExportError::Git("the Git directory path is not UTF-8".to_owned()))?;
        Ok(path_line(&text).to_owned())
    }

    /// Run `git <args>` and return stdout with surrounding whitespace trimmed.
    pub fn run(
        &self,
        args: &[&str],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
    ) -> Result<String, ExportError> {
        let raw = self.exec(args, stdin, env)?;
        Ok(String::from_utf8_lossy(&raw).trim().to_owned())
    }

    /// Run `git <args>` for its exit code alone (`None`: killed by a signal).
    pub fn status(&self, args: &[&str]) -> Result<Option<i32>, ExportError> {
        Ok(self.output(args, None, &[])?.status.code())
    }

    /// Run `git <args>` and return stdout byte for byte.
    pub fn run_raw(&self, args: &[&str], stdin: Option<&[u8]>) -> Result<Vec<u8>, ExportError> {
        self.exec(args, stdin, &[])
    }

    fn exec(
        &self,
        args: &[&str],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
    ) -> Result<Vec<u8>, ExportError> {
        finish(args, self.output(args, stdin, env)?)
    }

    fn output(
        &self,
        args: &[&str],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
    ) -> Result<std::process::Output, ExportError> {
        let dir = self.dir.to_string_lossy();
        let mut full: Vec<&str> = vec!["-C", &dir];
        full.extend(FIXED_CONFIG);
        full.extend(args);
        let mut cmd = build_command(&self.program, &full);
        for key in inherited_git_vars(std::env::vars_os().map(|(k, _)| k)) {
            cmd.env_remove(key);
        }
        cmd.env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_NO_REPLACE_OBJECTS", "1")
            .env("GIT_OPTIONAL_LOCKS", "0");
        if let Some(path) = &self.path_env {
            cmd.env("PATH", path);
        }
        cmd.envs(env.iter().copied())
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ExportError::GitMissing,
            _ => ExportError::Git(crate::ai_provider::spawn::spawn_failure(&self.program, &e)),
        })?;
        if let (Some(bytes), Some(pipe)) = (stdin, child.stdin.take()) {
            return fed_output(child, pipe, bytes.to_vec(), start_thread);
        }
        waited(child.wait_with_output())
    }
}

/// The inherited variable names Git would read (`GIT_*`), which every
/// invocation removes before setting its own. Matched without regard to
/// case: Windows names are case-insensitive, so `Git_Dir` is `GIT_DIR` there.
pub fn inherited_git_vars(
    names: impl Iterator<Item = std::ffi::OsString>,
) -> Vec<std::ffi::OsString> {
    names
        .filter(|k| {
            k.to_string_lossy()
                .get(..4)
                .is_some_and(|p| p.eq_ignore_ascii_case("GIT_"))
        })
        .collect()
}

fn finish(args: &[&str], out: std::process::Output) -> Result<Vec<u8>, ExportError> {
    if out.status.success() {
        return Ok(out.stdout);
    }
    let sub = args
        .iter()
        .find(|a| !a.starts_with('-'))
        .copied()
        .unwrap_or("git");
    let stderr = String::from_utf8_lossy(&out.stderr);
    let first = stderr
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    Err(ExportError::Git(format!(
        "git {sub} exited with {}: {first}",
        out.status
    )))
}

/// A path Git printed on one line, without Git's line terminator: one
/// `\n`, and on Windows the `\r` before it. A Unix name may itself end in
/// `\r`, so there it is kept; Windows forbids it in names.
pub(crate) fn path_line(text: &str) -> &str {
    let line = text.strip_suffix('\n').unwrap_or(text);
    if cfg!(windows) {
        line.strip_suffix('\r').unwrap_or(line)
    } else {
        line
    }
}
