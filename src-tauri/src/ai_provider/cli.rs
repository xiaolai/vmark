//! CLI provider execution.
//!
//! Spawns CLI AI tools (claude, codex, gemini) as child processes via
//! `tokio::process::Command` and forwards stdout to a sink. Async I/O lets
//! the parent task kill the child via `child.kill().await` when the caller
//! cancels (e.g., the workflow runner's per-step timeout fires).

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio_util::sync::CancellationToken;

use super::detection::login_shell_path;
use super::sink::AiSink;
use super::spawn::build_command;
use stream::{next_bounded_chunk, spawn_stderr_drain};

mod stream;

/// Maximum time a CLI provider is allowed to run before being killed.
const CLI_TIMEOUT: Duration = Duration::from_secs(300);

// ============================================================================
// Public Entry
// ============================================================================

/// Run a CLI AI provider, forwarding stdout to the sink.
///
/// `cancel` allows the caller to kill the child process from another task —
/// the runner's per-step timeout (WI-2.5) and the user's Cancel button
/// (Phase 4) both signal this token. The CLI process is force-killed within
/// one tokio scheduler tick of the cancel signal.
///
/// The internal hard cap of `CLI_TIMEOUT` (300s) acts as a safety net so a
/// stuck provider doesn't leak forever even if the caller never cancels.
pub(super) async fn run_cli_blocking(
    sink: Arc<dyn AiSink>,
    cancel: CancellationToken,
    provider: &str,
    args: Vec<String>,
    stdin_prompt: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    let outcome = tokio::time::timeout(
        CLI_TIMEOUT,
        run_cli_provider(
            Arc::clone(&sink),
            cancel.clone(),
            provider,
            &args,
            stdin_prompt.as_deref(),
            cli_path.as_deref(),
        ),
    )
    .await;

    match outcome {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => {
            // run_cli_provider already emits sink errors on most paths, but
            // spawn and stdin failures return Err without emitting.
            sink.error(&e);
            Err(e)
        }
        Err(_elapsed) => {
            let msg = format!("{provider} timed out after {}s", CLI_TIMEOUT.as_secs());
            cancel.cancel();
            sink.error(&msg);
            Err(msg)
        }
    }
}

// ============================================================================
// Internal Execution
// ============================================================================

/// Spawn the child, stream stdout to the sink, and wait for exit.
///
/// On `cancel`: kills the child, emits "Cancelled" through the sink, returns Ok
/// (cancellation is not a provider error from the runner's perspective; the
/// runner handles step state separately).
async fn run_cli_provider(
    sink: Arc<dyn AiSink>,
    cancel: CancellationToken,
    cmd: &str,
    args: &[String],
    stdin_prompt: Option<&str>,
    cli_path: Option<&str>,
) -> Result<(), String> {
    let stdin_cfg = if stdin_prompt.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    };
    let effective_cmd = cli_path.unwrap_or(cmd);

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let std_cmd = build_command(effective_cmd, &arg_refs);
    // Convert std::process::Command → tokio::process::Command so we can
    // kill the child from another task via child.kill().await.
    let mut tokio_cmd = TokioCommand::from(std_cmd);
    let mut child = tokio_cmd
        .env("PATH", login_shell_path())
        .stdin(stdin_cfg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true) // belt-and-suspenders if the future is dropped
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", cmd, e))?;

    // Pipe prompt to stdin when expected.
    if let Some(prompt) = stdin_prompt {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            // stdin is dropped here, closing it
        }
    }

    // Read stdout line-by-line concurrently with cancellation polling.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Child stdout pipe missing".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut pending: Vec<u8> = Vec::new();
    // Drain stderr concurrently — a chatty-stderr child would otherwise fill
    // the ~64 KiB pipe buffer, block on write, and never reach stdout EOF.
    let stderr_drain = spawn_stderr_drain(child.stderr.take());

    let read_result = loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                sink.error("Cancelled");
                return Ok(());
            }
            chunk = next_bounded_chunk(&mut reader, &mut pending) => {
                match chunk {
                    Ok(Some(text)) => {
                        sink.chunk(&text);
                    }
                    Ok(None) => break Ok(()),       // EOF
                    Err(e) => {
                        let _ = child.kill().await;
                        break Err(format!("Read error: {}", e));
                    }
                }
            }
        }
    };

    if let Err(e) = read_result {
        sink.error(&e);
        return Ok(());
    }

    // Wait for exit (also cancellable to avoid hangs after EOF).
    let status = tokio::select! {
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            sink.error("Cancelled");
            return Ok(());
        }
        status = child.wait() => status.map_err(|e| format!("Wait failed: {}", e))?,
    };

    if !status.success() {
        // The concurrent drain retains a capped stderr head for the message.
        let stderr_text = match stderr_drain {
            Some(task) => task.await.unwrap_or_default(),
            None => String::new(),
        };
        let msg = if stderr_text.is_empty() {
            format!("{} exited with status {}", cmd, status)
        } else {
            format!("{} exited with status {}: {}", cmd, status, stderr_text)
        };
        sink.error(&msg);
    } else {
        sink.done();
    }

    Ok(())
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
