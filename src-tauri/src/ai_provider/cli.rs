//! CLI provider execution.
//!
//! Spawns CLI AI tools (claude, codex, gemini) as child processes,
//! optionally piping the prompt via stdin, and streams stdout back to
//! the frontend as `ai:response` events.  The heavy I/O work runs on
//! tokio's blocking thread pool to avoid starving the async runtime.

use std::io::{BufRead, BufReader, Write as IoWrite};
use std::process::{Command, Stdio};
use tauri::WebviewWindow;

use super::detection::login_shell_path;
use super::types::{emit_chunk, emit_done, emit_error};

// ============================================================================
// Command Building
// ============================================================================

/// Build a `Command` for the given executable and args.
///
/// On Windows, `.cmd`/`.bat` shims (created by npm/yarn global installs)
/// must run through `cmd.exe /c`.  On macOS/Linux this is a plain spawn.
pub(crate) fn build_command(exe: &str, args: &[&str]) -> Command {
    if cfg!(target_os = "windows") {
        let lower = exe.to_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut c = Command::new("cmd");
            c.args(["/c", exe]);
            c.args(args);
            return c;
        }
    }
    let mut c = Command::new(exe);
    c.args(args);
    c
}

// ============================================================================
// Blocking Wrapper
// ============================================================================

/// Offload a CLI provider to the blocking thread pool so it doesn't starve tokio.
///
/// On any error (join failure, spawn failure, etc.) emits a terminal `ai:response`
/// event so the frontend never hangs waiting for a `done` signal.
pub(super) async fn run_cli_blocking(
    window: &WebviewWindow,
    request_id: &str,
    provider: &str,
    args: Vec<String>,
    stdin_prompt: Option<String>,
    cli_path: Option<String>,
) -> Result<(), String> {
    let w = window.clone();
    let rid = request_id.to_string();
    let prov = provider.to_string();
    let result = tokio::task::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_cli_provider(
            &w,
            &rid,
            &prov,
            &arg_refs,
            stdin_prompt.as_deref(),
            cli_path.as_deref(),
        )
    })
    .await;

    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => {
            // run_cli_provider already emits error/done events on most paths,
            // but spawn and stdin-write failures return Err without emitting.
            emit_error(window, request_id, &e);
            Err(e)
        }
        Err(join_err) => {
            let msg = format!("Task join error: {join_err}");
            emit_error(window, request_id, &msg);
            Err(msg)
        }
    }
}

// ============================================================================
// CLI Execution
// ============================================================================

/// Run a CLI AI provider and stream stdout back as `ai:response` events.
///
/// When `stdin_prompt` is `Some`, the prompt is piped to stdin (for
/// providers like `claude --print` and `ollama run`).  When `None`,
/// the prompt must already be embedded in `args` (for providers like
/// `codex exec` and `gemini -p`).
///
/// `cli_path` is the resolved path from detection.  When available it
/// is used instead of the bare command name so that Windows `.cmd`
/// shims are handled correctly.
fn run_cli_provider(
    window: &WebviewWindow,
    request_id: &str,
    cmd: &str,
    args: &[&str],
    stdin_prompt: Option<&str>,
    cli_path: Option<&str>,
) -> Result<(), String> {
    let stdin_cfg = if stdin_prompt.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    };
    let effective_cmd = cli_path.unwrap_or(cmd);

    let mut child = build_command(effective_cmd, args)
        .env("PATH", login_shell_path())
        .stdin(stdin_cfg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", cmd, e))?;

    // Write prompt to stdin when the provider expects it
    if let Some(prompt) = stdin_prompt {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            // stdin is dropped here, closing it
        }
    }

    // Stream stdout line by line
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    emit_chunk(window, request_id, &(text + "\n"));
                }
                Err(e) => {
                    emit_error(window, request_id, &format!("Read error: {}", e));
                    let _ = child.kill();
                    return Ok(());
                }
            }
        }
    }

    // Check exit status -- include stderr in error message
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Wait failed: {}", e))?;
    if !output.status.success() {
        let stderr_text = String::from_utf8_lossy(&output.stderr);
        let stderr_msg = stderr_text.trim();
        let msg = if stderr_msg.is_empty() {
            format!("{} exited with status {}", cmd, output.status)
        } else {
            format!(
                "{} exited with status {}: {}",
                cmd, output.status, stderr_msg
            )
        };
        emit_error(window, request_id, &msg);
    } else {
        emit_done(window, request_id);
    }

    Ok(())
}
