//! Bounded child-output streaming for CLI providers.
//!
//! Two safety properties for reading a CLI child's pipes:
//!
//!   - **Bounded stdout buffering** — `next_bounded_chunk` emits line chunks
//!     but caps the per-line buffer at [`MAX_LINE_BYTES`], so a newline-free
//!     stream cannot exhaust memory.
//!   - **Concurrent stderr drain** — `spawn_stderr_drain` keeps the stderr
//!     pipe flowing while stdout is being read, so a chatty-stderr child
//!     cannot fill the pipe buffer and deadlock until the provider timeout.

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

/// Maximum bytes buffered for a single output line before it is flushed as a
/// chunk anyway — a newline-free stream must not buffer unboundedly.
pub(super) const MAX_LINE_BYTES: usize = 1024 * 1024;

/// Maximum stderr bytes retained for the error message. The rest of the
/// stream is still drained (and discarded) so the child never blocks on a
/// full stderr pipe.
pub(super) const MAX_STDERR_BYTES: u64 = 64 * 1024;

/// Drain the child's stderr concurrently with stdout so a chatty-stderr
/// child cannot fill the pipe buffer and deadlock the stdout loop. Retains
/// at most [`MAX_STDERR_BYTES`] for the error message; the rest is read and
/// discarded. The task ends when the pipe closes (child exit or kill), so
/// callers on early-return paths can safely leave it detached.
pub(super) fn spawn_stderr_drain(
    stderr: Option<tokio::process::ChildStderr>,
) -> Option<tokio::task::JoinHandle<String>> {
    stderr.map(|mut pipe| {
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = (&mut pipe)
                .take(MAX_STDERR_BYTES)
                .read_to_end(&mut buf)
                .await;
            // Keep draining (discarding) past the cap so the child never blocks.
            let _ = tokio::io::copy(&mut pipe, &mut tokio::io::sink()).await;
            String::from_utf8_lossy(&buf).trim().to_string()
        })
    })
}

/// Read the next bounded chunk from `reader`.
///
/// Emits one complete line per chunk with a normalized trailing `'\n'`
/// (CRLF becomes `'\n'`, and a trailing partial line at EOF also gets one,
/// matching the previous `lines()`-based behavior). A newline-free stretch
/// longer than [`MAX_LINE_BYTES`] is flushed as-is in capped chunks so a
/// pathological provider cannot buffer unbounded memory. Cap flushes never
/// split a UTF-8 code point; invalid UTF-8 is converted lossily instead of
/// aborting the stream.
///
/// Returns `Ok(None)` at EOF once `pending` is empty. Cancel-safe: partial
/// data lives in `pending`, which the caller owns across polls.
pub(super) async fn next_bounded_chunk<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    pending: &mut Vec<u8>,
) -> std::io::Result<Option<String>> {
    loop {
        let taken = {
            let buf = reader.fill_buf().await?;
            if buf.is_empty() {
                // EOF — flush any trailing partial line as a final chunk.
                if pending.is_empty() {
                    return Ok(None);
                }
                let out = finish_line(pending);
                return Ok(Some(out));
            }
            let remaining = MAX_LINE_BYTES - pending.len();
            match buf.iter().take(remaining).position(|&b| b == b'\n') {
                Some(pos) => {
                    pending.extend_from_slice(&buf[..=pos]);
                    let out = finish_line(pending);
                    reader.consume(pos + 1);
                    return Ok(Some(out));
                }
                None => {
                    let take = buf.len().min(remaining);
                    pending.extend_from_slice(&buf[..take]);
                    take
                }
            }
        };
        reader.consume(taken);
        if pending.len() >= MAX_LINE_BYTES {
            // Cap reached without a newline — flush up to a char boundary.
            let split = utf8_floor(pending, pending.len());
            let out = String::from_utf8_lossy(&pending[..split]).into_owned();
            pending.drain(..split);
            return Ok(Some(out));
        }
    }
}

/// Convert an accumulated line to a chunk string: strip the trailing
/// `\n`/`\r\n` if present, append a single `'\n'`, clear the buffer.
fn finish_line(pending: &mut Vec<u8>) -> String {
    if pending.last() == Some(&b'\n') {
        pending.pop();
    }
    if pending.last() == Some(&b'\r') {
        pending.pop();
    }
    let mut out = String::from_utf8_lossy(pending).into_owned();
    out.push('\n');
    pending.clear();
    out
}

/// Largest split point ≤ `end` that does not cut a UTF-8 code point.
/// If the trailing bytes aren't valid UTF-8 anyway, splits at `end`
/// (the lossy conversion handles the garbage).
pub(super) fn utf8_floor(buf: &[u8], end: usize) -> usize {
    // Walk back over trailing continuation bytes to the last lead byte.
    let mut j = end;
    while j > 0 && end - j < 4 && (buf[j - 1] & 0xC0) == 0x80 {
        j -= 1;
    }
    if j == 0 || end - j >= 4 {
        return end; // all continuations or ran off the front — not valid UTF-8
    }
    let lead = buf[j - 1];
    let len = match lead {
        b if b & 0x80 == 0 => 1,
        b if b & 0xE0 == 0xC0 => 2,
        b if b & 0xF0 == 0xE0 => 3,
        b if b & 0xF8 == 0xF0 => 4,
        _ => 1, // invalid lead byte — treat as a single byte
    };
    if (j - 1) + len <= end {
        end // last code point is complete
    } else {
        j - 1 // split before the incomplete code point
    }
}
