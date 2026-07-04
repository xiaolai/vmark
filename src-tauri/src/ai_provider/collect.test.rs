//! Tests for `run_ai_prompt_collect` / `collect_from_channel` (mod.rs).

use super::*;

/// Write an executable `#!/bin/sh` shim into `dir` and return its path.
/// Used as a controlled CLI stand-in: unlike real binaries, its behavior
/// (ignore args, sleep, print) is fully deterministic.
#[cfg(unix)]
fn write_shim(dir: &tempfile::TempDir, body: &str) -> std::path::PathBuf {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let path = dir.path().join("cli-shim");
    let mut f = std::fs::File::create(&path).unwrap();
    write!(f, "#!/bin/sh\n{body}\n").unwrap();
    drop(f);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// A successful CLI provider completion returns the collected text.
///
/// Unix-only: relies on `/bin/echo` ignoring unknown flags. Windows has
/// no `/bin/echo` (echo is a cmd.exe builtin) so this path can't be
/// exercised cross-platform. macOS BSD echo and Linux GNU echo both
/// pass the test — they print all positional args including the prompt.
#[cfg(unix)]
#[tokio::test]
async fn collect_returns_text_on_done() {
    let cancel = CancellationToken::new();
    let result = run_ai_prompt_collect(
        cancel,
        "claude",
        "ignored",
        None,
        None,
        None,
        // Force cli_path to /bin/echo. The args list emitted by
        // dispatch_to_provider for "claude" is not what `echo` expects,
        // but echo prints all its args verbatim. We assert "ignored"
        // appears in the captured stdout.
        Some("/bin/echo"),
        None,
    )
    .await;

    assert!(result.is_ok(), "expected Ok got {:?}", result);
    let text = result.unwrap();
    assert!(
        text.contains("ignored"),
        "expected echoed prompt in {}",
        text
    );
}

/// Cancellation aborts the collect with the canonical error.
///
/// Tests the run_ai_prompt_collect → dispatch_to_provider →
/// cli::run_cli_blocking cancel-token plumbing end-to-end. The CLI
/// path is built with claude's args (which include `-p`); the shim
/// ignores them and stays alive silently until the cancel arrives —
/// a firehose stand-in like `/usr/bin/yes` could hit the output cap
/// before the delayed cancel fires and make the test flaky.
///
/// The single-cli-level cancel primitive (no dispatcher) is covered
/// portably by `cli::tests::cancellation_kills_long_running_shim` —
/// this test verifies the additional dispatcher + collect layers.
#[cfg(unix)]
#[tokio::test]
async fn collect_cancellation_returns_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let shim = write_shim(&dir, "exec sleep 30");
    let shim_path = shim.to_str().unwrap().to_string();

    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();

    let task = tokio::spawn(async move {
        run_ai_prompt_collect(
            cancel_clone,
            "claude",
            "ignored",
            None,
            None,
            None,
            Some(&shim_path),
            None,
        )
        .await
    });

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    cancel.cancel();

    let outcome = tokio::time::timeout(std::time::Duration::from_secs(3), task)
        .await
        .expect("task did not return within 3s of cancel");
    let result = outcome.unwrap();
    assert!(
        matches!(result, Err(ref e) if e == "Cancelled"),
        "expected Err(Cancelled), got {:?}",
        result
    );
}

/// A provider that floods stdout is aborted with the byte-cap error
/// instead of collecting unboundedly.
#[cfg(unix)]
#[tokio::test]
async fn collect_enforces_output_cap() {
    let dir = tempfile::tempdir().unwrap();
    // Flood stdout forever to trip the byte cap. Ignore the provider's args and
    // run bare `yes` (prints "y" endlessly): passing them through as `yes "$@"`
    // is not portable — GNU `yes` (Linux) rejects the `-p` flag the claude
    // provider emits, while BSD `yes` (macOS) treats it as text.
    let shim = write_shim(&dir, "exec yes");
    let shim_path = shim.to_str().unwrap().to_string();

    let cancel = CancellationToken::new();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        run_ai_prompt_collect(
            cancel,
            "claude",
            "ignored",
            None,
            None,
            None,
            Some(&shim_path),
            None,
        ),
    )
    .await
    .expect("cap must abort the collect well before the provider timeout");

    assert!(
        matches!(result, Err(ref e) if e.contains("exceeded")),
        "expected cap error, got {:?}",
        result
    );
}

/// Unknown provider yields an error path through the sink.
#[tokio::test]
async fn collect_unknown_provider_errors() {
    let cancel = CancellationToken::new();
    let result = run_ai_prompt_collect(
        cancel,
        "no-such-provider",
        "anything",
        None,
        None,
        None,
        None,
        None,
    )
    .await;
    assert!(matches!(result, Err(ref msg) if msg.contains("Unknown provider")));
}

/// The sink contract requires exactly one terminal Done/Error event. If the
/// channel closes without one (provider bug/crash), the collected text may
/// be truncated — the collect must surface an error, never Ok(partial).
#[tokio::test]
async fn collect_errors_when_stream_closes_without_done() {
    let (tx, rx) = tokio::sync::mpsc::channel::<ChannelEvent>(COLLECT_CHANNEL_CAPACITY);
    let cancel = CancellationToken::new();
    let overflowed = Arc::new(AtomicBool::new(false));

    let dispatch = {
        let sink = ChannelSink::new(tx, cancel.clone(), Arc::clone(&overflowed));
        async move {
            sink.chunk("partial ");
            sink.chunk("output");
            // Contract violation: return Ok WITHOUT emitting Done or Error.
            Ok(())
        }
    };

    let result = collect_from_channel(cancel, overflowed, rx, dispatch).await;
    assert_eq!(
        result,
        Err("stream ended without done signal".to_string()),
        "close-without-Done must not be treated as success"
    );
}

/// Chunks queued before the terminal Done are all collected, in order,
/// including when they arrive in a burst (the drain path).
#[tokio::test]
async fn collect_drains_burst_before_done() {
    let (tx, rx) = tokio::sync::mpsc::channel::<ChannelEvent>(COLLECT_CHANNEL_CAPACITY);
    let cancel = CancellationToken::new();
    let overflowed = Arc::new(AtomicBool::new(false));

    let dispatch = {
        let sink = ChannelSink::new(tx, cancel.clone(), Arc::clone(&overflowed));
        async move {
            for i in 0..100 {
                sink.chunk(&format!("{i},"));
            }
            sink.done();
            Ok(())
        }
    };

    let result = collect_from_channel(cancel, overflowed, rx, dispatch).await;
    let text = result.expect("burst must collect cleanly");
    assert!(text.starts_with("0,1,2,"));
    assert!(text.ends_with("98,99,"));
}

/// Overflow must win over the channel-closed terminal, deterministically.
///
/// When the sink's byte-gate trips it sets `overflowed` and fires `cancel`,
/// which (for a real provider) kills the child and closes the channel. Here we
/// reproduce that shape without any process/`yes` timing: the dispatch future
/// floods the sink past the cap, then returns — dropping the sink and closing
/// the channel. The collector then drains the buffered flood and hits the
/// channel-closed (`recv` → `None`) arm, which previously returned "stream
/// ended without done signal" and made the cap outcome flaky. Every terminal
/// path now funnels through the overflow check, so the cap error always wins.
#[tokio::test]
async fn collect_reports_cap_error_when_overflow_closes_channel() {
    let (tx, rx) = tokio::sync::mpsc::channel::<ChannelEvent>(COLLECT_CHANNEL_CAPACITY);
    let cancel = CancellationToken::new();
    let overflowed = Arc::new(AtomicBool::new(false));

    let dispatch = {
        let sink = ChannelSink::new(tx, cancel.clone(), Arc::clone(&overflowed));
        async move {
            // 64 KiB chunks divide the 5 MiB cap evenly, so the byte-gate trips
            // after exactly `MAX_COLLECT_BYTES` is buffered — the accumulated
            // text lands on the cap without exceeding it, forcing the collector
            // through the channel-closed arm rather than the text-cap check.
            let chunk = "x".repeat(64 * 1024);
            let pushes = (MAX_COLLECT_BYTES / chunk.len()) * 2;
            for _ in 0..pushes {
                sink.chunk(&chunk);
            }
            Ok(())
        }
    };

    let result = collect_from_channel(cancel, overflowed, rx, dispatch).await;
    assert!(
        matches!(result, Err(ref e) if e.contains("exceeded")),
        "overflow must yield the cap error even when the channel closes, got {result:?}"
    );
}
