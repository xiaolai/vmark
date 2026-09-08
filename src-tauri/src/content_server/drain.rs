//! Turning a child's output pipe into log lines (#135, #315).
//!
//! Split from `spawn.rs` at the file-size gate, and it is a real seam: this
//! half knows nothing about processes, only about bytes arriving on a reader
//! that may stop mid-character. `spawn.rs` owns the child and the threads.
//!
//! @coordinates-with spawn.rs — `drain_on_thread` is the only caller
//! @module content_server/drain

use std::io::{BufRead, BufReader, Read};

/// Longest line forwarded whole. Anything longer is delivered in pieces of
/// this size, so a child that never writes a newline cannot grow this thread's
/// buffer without bound.
const MAX_LOG_LINE: u64 = 64 * 1024;

/// Feed every line of `reader` to `on_line` until EOF or a READ error.
///
/// Bytes, not `BufRead::lines()`: that iterator yields `Err` for a line that
/// is not UTF-8, and `map_while(Result::ok)` then ENDED the drain — the pipe's
/// read end was dropped with the child still writing, so its next write got
/// EPIPE (#135). Invalid UTF-8 is replaced and the drain continues; only a
/// genuine read error stops it, and that is logged. A line longer than
/// `MAX_LOG_LINE` is delivered in bounded pieces rather than buffered whole.
///
/// A piece cut by that BOUND is cut at a byte, which is not a character
/// boundary: a multi-byte code point straddling it had BOTH halves replaced,
/// so a CJK log line lost a character every 64 KiB (#315). The incomplete
/// suffix is carried into the next read instead — only when the bound made
/// the cut, and only for a truncated sequence, so invalid bytes mid-line are
/// still replaced where they are.
pub(super) fn drain_lines<R: Read>(reader: R, mut on_line: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let carried = buf.len() as u64;
        match (&mut reader)
            .take(MAX_LOG_LINE - carried)
            .read_until(b'\n', &mut buf)
        {
            Ok(0) => {
                // EOF with a carry: nothing is left to complete it with.
                if !buf.is_empty() {
                    on_line(&String::from_utf8_lossy(&buf));
                }
                break;
            }
            Ok(_) => {
                let ended_at_a_newline = matches!(buf.last(), Some(b'\n'));
                while matches!(buf.last(), Some(b'\n' | b'\r')) {
                    buf.pop();
                }
                let hold = if ended_at_a_newline {
                    0
                } else {
                    incomplete_tail(&buf)
                };
                let tail = buf.split_off(buf.len() - hold);
                on_line(&String::from_utf8_lossy(&buf));
                buf = tail;
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                log::warn!("[content-server] stopped draining child output: {e}");
                break;
            }
        }
    }
}

/// How many trailing bytes are the START of a code point whose rest has not
/// been read — 0 for anything else, invalid bytes included.
fn incomplete_tail(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => 0,
        // `error_len() == None` is exactly "unexpected end of input".
        Err(e) if e.error_len().is_none() => bytes.len() - e.valid_up_to(),
        Err(_) => 0,
    }
}

#[cfg(test)]
#[path = "drain.test.rs"]
mod tests;
