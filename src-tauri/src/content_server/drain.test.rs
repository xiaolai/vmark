//! Tests for `drain.rs`: the child's output pipe drained to EOF (#135), in
//! bounded pieces that never split a character (#315). Loaded via `#[path]`.

use super::{drain_lines, MAX_LOG_LINE};

fn drained(bytes: &[u8]) -> Vec<String> {
    let mut lines = Vec::new();
    drain_lines(std::io::Cursor::new(bytes.to_vec()), |line| {
        lines.push(line.to_string())
    });
    lines
}

#[test]
fn a_line_that_is_not_utf8_is_replaced_and_the_drain_continues() {
    // `lines().map_while(Result::ok)` stopped at the bad line and dropped the
    // pipe, so the child's NEXT write failed with EPIPE. Every line after it
    // must still arrive.
    let lines = drained(b"ok\n\xff\xfe bad\nafter\n");
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[0], "ok");
    assert!(lines[1].contains("bad"), "{lines:?}");
    assert_eq!(lines[2], "after");
}

#[test]
fn crlf_and_a_missing_final_newline_are_handled() {
    let lines = drained(b"one\r\ntwo");
    assert_eq!(lines, vec!["one".to_string(), "two".to_string()]);
}

#[test]
fn a_line_longer_than_the_cap_is_delivered_in_bounded_pieces_not_buffered_whole() {
    let long = vec![b'x'; 200_000];
    let lines = drained(&long);
    assert!(
        lines.len() >= 3,
        "expected the line in pieces, got {}",
        lines.len()
    );
    assert!(
        lines.iter().all(|l| l.len() as u64 <= MAX_LOG_LINE),
        "no piece may exceed the cap"
    );
    assert_eq!(
        lines.iter().map(String::len).sum::<usize>(),
        200_000,
        "every byte is delivered"
    );
}

// #315 — the cap cuts at a BYTE, and a byte is not a character. A multi-byte
// code point straddling the boundary used to be replaced twice, once at the
// end of one piece and once at the start of the next, so a CJK log line lost a
// character at every 64 KiB. Reassembled, the pieces must be the input.
#[test]
fn a_code_point_straddling_the_cap_is_not_split_into_replacement_characters() {
    // Pad so the boundary lands INSIDE the three bytes of '\u{4e2d}'.
    let pad = MAX_LOG_LINE as usize - 1;
    let mut bytes = vec![b'x'; pad];
    bytes.extend_from_slice("中文".as_bytes());
    let lines = drained(&bytes);
    let joined: String = lines.concat();
    assert!(
        !joined.contains('\u{FFFD}'),
        "no character was replaced: {:?}",
        &joined[joined.len().saturating_sub(20)..]
    );
    assert_eq!(joined, String::from_utf8(bytes).expect("valid utf-8"));
}

// The other half of the same rule: bytes that are not the start of a truncated
// character stay where they are and are still replaced (#135 is unchanged).
#[test]
fn invalid_bytes_mid_line_are_still_replaced_rather_than_carried() {
    let lines = drained(b"ok\n\xff\xfe bad\nafter\n");
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert!(lines[1].contains('\u{FFFD}'), "{lines:?}");
}
