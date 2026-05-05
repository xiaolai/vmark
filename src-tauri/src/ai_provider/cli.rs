//! CLI provider execution.
//!
//! Spawns CLI AI tools (claude, codex, gemini) as child processes via
//! `tokio::process::Command` and forwards stdout to a sink. Async I/O lets
//! the parent task kill the child via `child.kill().await` when the caller
//! cancels (e.g., the workflow runner's per-step timeout fires).

use std::process::{Command as StdCommand, Stdio};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio_util::sync::CancellationToken;

use super::detection::login_shell_path;
use super::sink::AiSink;

/// Maximum time a CLI provider is allowed to run before being killed.
const CLI_TIMEOUT: Duration = Duration::from_secs(300);

// ============================================================================
// Command Building
// ============================================================================

/// Build a `std::process::Command` for the given executable and args.
///
/// On Windows, `.cmd`/`.bat` shims (created by npm/yarn global installs)
/// must run through `cmd.exe /c`. On macOS/Linux this is a plain spawn.
///
/// Returns `std::process::Command` (not `tokio::process::Command`) so other
/// modules (pandoc, actionlint) can keep using synchronous spawn semantics.
/// `cli.rs` itself converts to `tokio::process::Command` at the call site.
pub(crate) fn build_command(exe: &str, args: &[&str]) -> StdCommand {
    #[cfg(target_os = "windows")]
    {
        let lower = exe.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            // Use absolute path to cmd.exe to prevent CWD/PATH hijack attacks
            let system_root =
                std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
            let cmd_path = std::path::PathBuf::from(system_root)
                .join("System32")
                .join("cmd.exe");
            let mut c = StdCommand::new(cmd_path);
            c.args(["/c", exe]);
            c.args(args);
            return c;
        }
    }
    let mut c = StdCommand::new(exe);
    c.args(args);
    c
}

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
    let mut reader = BufReader::new(stdout).lines();
    let stderr = child.stderr.take();

    let read_result = loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                sink.error("Cancelled");
                return Ok(());
            }
            line = reader.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        sink.chunk(&(text + "\n"));
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
        // Drain stderr for the error message.
        let stderr_text = if let Some(mut err_pipe) = stderr {
            let mut buf = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut err_pipe, &mut buf)
                .await
                .ok();
            String::from_utf8_lossy(&buf).trim().to_string()
        } else {
            String::new()
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
mod tests {
    use super::*;
    use crate::ai_provider::sink::testing::{RecordingSink, SinkEvent};

    /// Cancellation kills a long-running shim within a deadline.
    #[tokio::test]
    async fn cancellation_kills_long_running_shim() {
        let typed = Arc::new(RecordingSink::new());
        let sink: Arc<dyn AiSink> = typed.clone();

        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        // Use `sleep 30` as the long-running CLI shim. Available everywhere.
        let task = tokio::spawn(async move {
            run_cli_blocking(
                sink,
                cancel_clone,
                "sleep",
                vec!["30".into()],
                None,
                None,
            )
            .await
        });

        // Give the child a moment to spawn.
        tokio::time::sleep(Duration::from_millis(100)).await;
        cancel.cancel();

        // Should return promptly — well before the 30-second sleep would finish.
        let outcome = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .expect("task did not return within 3s of cancellation");
        outcome.unwrap().unwrap();

        // Sink received the Cancelled error event.
        let events = typed.events();
        assert!(
            events.iter().any(|e| matches!(e, SinkEvent::Error(msg) if msg == "Cancelled")),
            "expected Cancelled event in {:?}",
            events
        );
    }

    /// Successful exit emits Done, not Error.
    #[tokio::test]
    async fn successful_exit_emits_done() {
        let typed = Arc::new(RecordingSink::new());
        let sink: Arc<dyn AiSink> = typed.clone();
        let cancel = CancellationToken::new();

        // `echo hello` writes one line and exits 0.
        let result = run_cli_blocking(
            sink,
            cancel,
            "echo",
            vec!["hello-from-echo".into()],
            None,
            None,
        )
        .await;
        assert!(result.is_ok(), "got {:?}", result);

        let events = typed.events();
        // Echo's output should arrive as a chunk, then Done.
        assert!(
            events.iter().any(|e| matches!(e, SinkEvent::Chunk(s) if s.contains("hello-from-echo"))),
            "expected chunk with echo text in {:?}",
            events
        );
        assert!(
            events.iter().any(|e| matches!(e, SinkEvent::Done)),
            "expected Done in {:?}",
            events
        );
    }
}
