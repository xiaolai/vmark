//! Content-server runtime availability (WI-FL1.1 — the first step of plan
//! decision D1).
//!
//! Probes the two things `content_server_start` needs — `node` on the
//! login-shell PATH and the content-server `cli.js` — WITHOUT spawning either,
//! so the Knowledge Base panel can say what is missing instead of failing a
//! start, and so a packaged app's log records the truth once per launch
//! (`log_runtime_state`; `.github/workflows/release-smoke.yml` reads that line
//! from the staged DMG).
//!
//! Why it exists: v0.9.65 shipped View → Knowledge Base, `Ctrl+Shift+4` and the
//! palette command while no release build could satisfy `resolve_cli` (nothing
//! produces the bundled resource — see `bundle_manifest.rs`), so the feature
//! ended in `not-found` on every packaged install and nothing recorded it.
//!
//! `classify` is pure over the two resolver results; the command and the
//! startup probe are thin wrappers that run the blocking `which` off the IPC
//! thread. Neither takes a lock or touches the manager: a probe must never be
//! able to interfere with a server that is already running.
//!
//! The startup probe is detached but OBSERVED (#126): its observer's handle
//! is kept in managed state (`RuntimeProbe`) and settled from
//! `content_server::cleanup` at an orderly quit, so a log with no runtime
//! line always says why — `app.exit` ends the process through
//! `std::process::exit`, after which nothing can log.

use crate::command_error::CommandError;
use serde::Serialize;
use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager, Runtime};

use super::spawn::{resolve_cli_with_source, resolve_node, CliSource};

/// Prefix of the one startup log line. `release-smoke.yml` polls the packaged
/// app's log for it; `scripts/release-smoke-kb-runtime.test.mjs` reads it from
/// this file so the two cannot drift apart.
pub const LOG_PREFIX: &str = "content_server runtime:";

/// Whether one half of the runtime is present.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeState {
    Ready,
    Missing,
}

impl fmt::Display for RuntimeState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            RuntimeState::Ready => "ready",
            RuntimeState::Missing => "missing",
        })
    }
}

/// What a start would find, without starting anything. Wire shape (camelCase):
/// `{ node, nodePath, cli, cliSource, detail }` — absent optionals are `null`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentServerRuntime {
    pub node: RuntimeState,
    /// Absolute path of `node` when found.
    pub node_path: Option<String>,
    pub cli: RuntimeState,
    /// Which candidate in `resolve_cli`'s order produced the CLI, when found.
    pub cli_source: Option<CliSource>,
    /// The resolvers' own reasons for whatever is missing, `; `-joined.
    pub detail: Option<String>,
}

impl ContentServerRuntime {
    /// The single startup log line: state first, so `cli=missing` / `cli=ready`
    /// is greppable regardless of what follows.
    pub fn log_line(&self) -> String {
        let mut line = format!("{LOG_PREFIX} node={} cli={}", self.node, self.cli);
        // Debug-quoted, like `detail`: a path with a space is otherwise
        // ambiguous to a reader of the line, and a path with a newline — legal
        // on Unix — could forge a second log line (#125).
        if let Some(p) = &self.node_path {
            line.push_str(&format!(" node_path={p:?}"));
        }
        if let Some(s) = &self.cli_source {
            line.push_str(&format!(" cli_source={s}"));
        }
        if let Some(d) = &self.detail {
            line.push_str(&format!(" detail={d:?}"));
        }
        line
    }
}

/// Fold the two resolver results into one report. Pure.
pub fn classify(
    node: Result<String, String>,
    cli: Result<(PathBuf, CliSource), String>,
) -> ContentServerRuntime {
    let mut reasons: Vec<String> = Vec::new();
    let (node_state, node_path) = match node {
        Ok(path) => (RuntimeState::Ready, Some(path)),
        Err(reason) => {
            reasons.push(reason);
            (RuntimeState::Missing, None)
        }
    };
    let (cli_state, cli_source) = match cli {
        Ok((_, source)) => (RuntimeState::Ready, Some(source)),
        Err(reason) => {
            reasons.push(reason);
            (RuntimeState::Missing, None)
        }
    };
    ContentServerRuntime {
        node: node_state,
        node_path,
        cli: cli_state,
        cli_source,
        detail: (!reasons.is_empty()).then(|| reasons.join("; ")),
    }
}

/// Run both resolvers. Blocking (`which` through the login shell) — call from a
/// blocking task, never on the IPC thread.
pub fn probe(app: &AppHandle) -> ContentServerRuntime {
    classify(resolve_node(), resolve_cli_with_source(app))
}

/// Report what a start would find, without spawning anything.
#[tauri::command]
pub async fn content_server_runtime(app: AppHandle) -> Result<ContentServerRuntime, CommandError> {
    tauri::async_runtime::spawn_blocking(move || probe(&app))
        .await
        .map_err(|e| {
            CommandError::internal(format!(
                "content-server runtime probe did not complete: {e}"
            ))
        })
}

/// Startup probe: log one `content_server runtime: …` line so a packaged app's
/// log file records whether the Knowledge Base could start on this machine.
/// Detached — the app never waits on it — but OBSERVED (#126): the blocking
/// task's handle is awaited by an observer task, so a probe that panics or is
/// cancelled leaves a line saying so; and the observer's own handle is kept
/// (`keep_probe`) so an orderly quit can settle it (`settle_probe`).
pub fn log_runtime_state(app: AppHandle) {
    let probe_app = app.clone();
    let observer = tauri::async_runtime::spawn(async move {
        match tauri::async_runtime::spawn_blocking(move || probe(&probe_app)).await {
            Ok(runtime) => log::info!("{}", runtime.log_line()),
            Err(e) => log::error!("{LOG_PREFIX} probe did not complete: {e}"),
        }
    });
    keep_probe(&app, observer);
}

/// The startup probe's observer, held by the app for `settle_probe`.
#[derive(Default)]
pub(super) struct RuntimeProbe(Mutex<ProbeSlot>);

#[derive(Default)]
enum ProbeSlot {
    #[default]
    Unstarted,
    Running(JoinHandle<()>),
    Settled(ProbeAtShutdown),
}

/// What `settle_probe` found at an orderly quit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ProbeAtShutdown {
    /// The observer ran to its end: the runtime line — or the "did not
    /// complete" line — is in the log.
    Finished,
    /// Still running at quit: aborted, and said so in the log.
    StillRunning,
    /// `log_runtime_state` never ran this launch: said so in the log.
    NeverStarted,
}

/// The managed slot, created on first use so `settle_probe` has somewhere to
/// record a verdict even when nothing was ever kept.
fn probe_slot<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, RuntimeProbe> {
    if app.try_state::<RuntimeProbe>().is_none() {
        app.manage(RuntimeProbe::default());
    }
    app.state::<RuntimeProbe>()
}

/// Hold the observer's handle for `settle_probe`.
pub(super) fn keep_probe<R: Runtime>(app: &AppHandle<R>, observer: JoinHandle<()>) {
    let probe = probe_slot(app);
    let mut slot = probe.0.lock().unwrap_or_else(|p| p.into_inner());
    *slot = ProbeSlot::Running(observer);
}

/// At an orderly quit: was the one runtime line logged? A probe still running
/// is aborted and SAID SO, so a log with no `content_server runtime:` line
/// always carries the reason. Settles once: a second call (both quit paths
/// run the same cleanup) repeats the verdict without warning again.
pub(super) fn settle_probe<R: Runtime>(app: &AppHandle<R>) -> ProbeAtShutdown {
    let probe = probe_slot(app);
    let mut slot = probe.0.lock().unwrap_or_else(|p| p.into_inner());
    let verdict = match std::mem::take(&mut *slot) {
        ProbeSlot::Unstarted => {
            log::warn!(
                "{LOG_PREFIX} probe was never started; no runtime line was logged this launch"
            );
            ProbeAtShutdown::NeverStarted
        }
        ProbeSlot::Running(observer) if observer.inner().is_finished() => ProbeAtShutdown::Finished,
        ProbeSlot::Running(observer) => {
            log::warn!("{LOG_PREFIX} probe still running at shutdown; no runtime line was logged this launch");
            observer.abort();
            ProbeAtShutdown::StillRunning
        }
        ProbeSlot::Settled(verdict) => verdict,
    };
    *slot = ProbeSlot::Settled(verdict);
    verdict
}

#[cfg(test)]
#[path = "runtime.test.rs"]
mod tests;
