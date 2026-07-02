//! Tests for `cli.rs` — CLI provider execution.
//!
//! Unix-gated where a real child binary is required: the shims used
//! (`sleep`, `echo`, `sh`) are POSIX utilities with no portable Windows
//! equivalent (Windows `echo` is a cmd.exe builtin, there is no `sleep.exe`).

use super::stream::{next_bounded_chunk, utf8_floor, MAX_LINE_BYTES, MAX_STDERR_BYTES};
use super::*;
use crate::ai_provider::sink::testing::{RecordingSink, SinkEvent};

/// Cancellation kills a long-running shim within a deadline.
#[cfg(unix)]
#[tokio::test]
async fn cancellation_kills_long_running_shim() {
    let typed = Arc::new(RecordingSink::new());
    let sink: Arc<dyn AiSink> = typed.clone();

    let cancel = CancellationToken::new();
    let cancel_clone = cancel.clone();

    // Use `sleep 30` as the long-running CLI shim (POSIX; Unix-only test).
    let task = tokio::spawn(async move {
        run_cli_blocking(sink, cancel_clone, "sleep", vec!["30".into()], None, None).await
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
        events
            .iter()
            .any(|e| matches!(e, SinkEvent::Error(msg) if msg == "Cancelled")),
        "expected Cancelled event in {:?}",
        events
    );
}

/// Successful exit emits Done, not Error.
#[cfg(unix)]
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
        events
            .iter()
            .any(|e| matches!(e, SinkEvent::Chunk(s) if s.contains("hello-from-echo"))),
        "expected chunk with echo text in {:?}",
        events
    );
    assert!(
        events.iter().any(|e| matches!(e, SinkEvent::Done)),
        "expected Done in {:?}",
        events
    );
}

/// A child that floods stderr (well past the ~64 KiB pipe buffer) before
/// exiting must not deadlock. Without a concurrent stderr drain the child
/// blocks on its full stderr pipe, stdout never reaches EOF, and this call
/// hangs until the 300 s provider timeout.
#[cfg(unix)]
#[tokio::test]
async fn chatty_stderr_child_does_not_deadlock() {
    let typed = Arc::new(RecordingSink::new());
    let sink: Arc<dyn AiSink> = typed.clone();
    let cancel = CancellationToken::new();

    // 256 KiB of 'e' to stderr, then a marker line, then non-zero exit.
    let script = "head -c 262144 /dev/zero | tr '\\0' e >&2; echo marker-tail >&2; exit 3";
    let result = tokio::time::timeout(
        Duration::from_secs(10),
        run_cli_blocking(
            sink,
            cancel,
            "sh",
            vec!["-c".into(), script.into()],
            None,
            None,
        ),
    )
    .await
    .expect("run_cli_blocking must not deadlock on chatty stderr");

    // Non-zero exits are reported through the sink, not the return value.
    assert!(result.is_ok(), "got {:?}", result);
    let events = typed.events();
    let err = events
        .iter()
        .find_map(|e| match e {
            SinkEvent::Error(m) => Some(m.clone()),
            _ => None,
        })
        .expect("expected an Error event");
    assert!(
        err.contains("exited with status"),
        "expected exit-status error, got: {}…",
        &err[..err.len().min(120)]
    );
    // Retained stderr is capped: 64 KiB tail cap + message prefix.
    assert!(
        err.len() <= MAX_STDERR_BYTES as usize + 256,
        "stderr retention must be capped, got {} bytes",
        err.len()
    );
}

// ---------------------------------------------------------------------------
// next_bounded_chunk — bounded line reading (audit F2)
// ---------------------------------------------------------------------------

/// Complete lines are emitted one per chunk with a trailing '\n'; a trailing
/// partial line is flushed with an appended '\n' (matching the previous
/// `lines()`-based behavior).
#[tokio::test]
async fn bounded_chunk_emits_lines_and_trailing_partial() {
    let mut reader: &[u8] = b"hello\nworld\ntail";
    let mut pending = Vec::new();

    let mut chunks = Vec::new();
    while let Some(c) = next_bounded_chunk(&mut reader, &mut pending).await.unwrap() {
        chunks.push(c);
    }
    assert_eq!(chunks, vec!["hello\n", "world\n", "tail\n"]);
}

/// CRLF line endings are normalized to '\n' (matching `lines()`).
#[tokio::test]
async fn bounded_chunk_normalizes_crlf() {
    let mut reader: &[u8] = b"a\r\nb\r\n";
    let mut pending = Vec::new();

    let mut chunks = Vec::new();
    while let Some(c) = next_bounded_chunk(&mut reader, &mut pending).await.unwrap() {
        chunks.push(c);
    }
    assert_eq!(chunks, vec!["a\n", "b\n"]);
}

/// A newline-free stream larger than MAX_LINE_BYTES is flushed in bounded
/// chunks instead of buffering the whole "line" (the F2 memory-exhaustion
/// vector). Content is preserved across flush boundaries.
#[tokio::test]
async fn bounded_chunk_caps_newline_free_stream() {
    let data = "a".repeat(MAX_LINE_BYTES + MAX_LINE_BYTES / 2);
    let mut reader: &[u8] = data.as_bytes();
    let mut pending = Vec::new();

    let mut chunks = Vec::new();
    while let Some(c) = next_bounded_chunk(&mut reader, &mut pending).await.unwrap() {
        assert!(
            c.len() <= MAX_LINE_BYTES,
            "chunk exceeded cap: {} bytes",
            c.len()
        );
        chunks.push(c);
    }
    assert!(chunks.len() >= 2, "expected multiple capped flushes");
    // Last chunk is the EOF partial-line flush, which appends '\n'.
    assert_eq!(chunks.concat(), format!("{data}\n"));
}

/// A multi-byte UTF-8 code point straddling the cap boundary is not split
/// (no U+FFFD replacement characters appear in the output).
#[tokio::test]
async fn bounded_chunk_does_not_split_utf8_at_cap() {
    // MAX-1 ASCII bytes, then a 3-byte '€' that straddles the cap.
    let data = format!("{}€", "a".repeat(MAX_LINE_BYTES - 1));
    let mut reader: &[u8] = data.as_bytes();
    let mut pending = Vec::new();

    let mut out = String::new();
    while let Some(c) = next_bounded_chunk(&mut reader, &mut pending).await.unwrap() {
        out.push_str(&c);
    }
    assert!(!out.contains('\u{FFFD}'), "UTF-8 was split at cap boundary");
    assert_eq!(out, format!("{data}\n"));
}

/// Invalid UTF-8 is replaced lossily instead of aborting the stream.
#[tokio::test]
async fn bounded_chunk_lossy_on_invalid_utf8() {
    let mut reader: &[u8] = b"ok\n\xFF\xFE\n";
    let mut pending = Vec::new();

    let mut chunks = Vec::new();
    while let Some(c) = next_bounded_chunk(&mut reader, &mut pending).await.unwrap() {
        chunks.push(c);
    }
    assert_eq!(chunks[0], "ok\n");
    assert!(chunks[1].contains('\u{FFFD}'));
}

/// utf8_floor: split points never cut a code point; garbage falls back to
/// splitting at the cap.
#[test]
fn utf8_floor_boundaries() {
    let euro = "€".as_bytes(); // E2 82 AC
    let mut buf = b"a".to_vec();
    buf.extend_from_slice(euro);
    assert_eq!(utf8_floor(&buf, 2), 1); // a + lead byte → split before lead
    assert_eq!(utf8_floor(&buf, 3), 1); // a + 2 of 3 bytes → split before lead
    assert_eq!(utf8_floor(&buf, 4), 4); // complete → split at end
    assert_eq!(utf8_floor(b"abcd", 4), 4); // pure ASCII
    assert_eq!(utf8_floor(&[0x80; 8], 8), 8); // invalid: all continuations
}
