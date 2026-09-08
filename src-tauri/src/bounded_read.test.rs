//! Tests for `bounded_read.rs` (#148, #253, #254). Loaded via `#[path]`.

use super::{open_regular, read_bounded_stream, read_regular_bounded, BoundedReadError};
use std::fs;
use std::io::Write;

#[test]
fn a_file_within_the_limit_is_read_whole() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("small.md");
    fs::write(&path, b"hello").expect("write");
    assert_eq!(read_regular_bounded(&path, 5).expect("read"), b"hello");
    assert_eq!(read_regular_bounded(&path, 1000).expect("read"), b"hello");
}

#[test]
fn a_file_over_the_limit_is_refused_on_the_bytes_read() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("big.md");
    fs::write(&path, vec![b'a'; 101]).expect("write");
    let err = read_regular_bounded(&path, 100).expect_err("101 > 100");
    assert!(
        matches!(err, BoundedReadError::TooLarge { limit: 100 }),
        "{err:?}"
    );
    assert!(err.to_string().contains("too large"), "{err}");
}

#[test]
fn a_sparse_file_is_refused_by_its_reported_size_without_being_read() {
    // `set_len` costs no disk; the handle's size is what refuses it, and the
    // refusal must not first read a gigabyte of zeros.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("sparse.md");
    let file = fs::File::create(&path).expect("create");
    file.set_len(1 << 30).expect("set_len");
    let started = std::time::Instant::now();
    let err = read_regular_bounded(&path, 1024).expect_err("a gigabyte is over 1 KiB");
    assert!(matches!(err, BoundedReadError::TooLarge { .. }), "{err:?}");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "refused by size, not by reading: {:?}",
        started.elapsed()
    );
}

#[test]
fn a_directory_is_not_a_regular_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = read_regular_bounded(dir.path(), 1024).expect_err("a directory");
    assert!(matches!(err, BoundedReadError::NotRegular), "{err:?}");
}

#[test]
fn a_missing_path_is_an_io_error_naming_the_cause() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = read_regular_bounded(&dir.path().join("gone.md"), 1024).expect_err("missing");
    match err {
        BoundedReadError::Io(e) => assert_eq!(e.kind(), std::io::ErrorKind::NotFound),
        other => panic!("expected Io, got {other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn a_fifo_is_refused_without_blocking_for_a_writer() {
    // The reason the open is O_NONBLOCK: a plain open of a FIFO for reading
    // waits for a writer that, for a planted pipe, never comes (#253).
    let dir = tempfile::tempdir().expect("tempdir");
    let fifo = dir.path().join("pipe.md");
    let c_path = std::ffi::CString::new(fifo.to_str().unwrap()).expect("cstring");
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0, "mkfifo");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(open_regular(&fifo).map(|_| ()));
    });
    let outcome = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the open must return, not block on the FIFO");
    assert!(
        matches!(outcome, Err(BoundedReadError::NotRegular)),
        "{outcome:?}"
    );
}

#[test]
fn the_size_and_type_come_from_the_open_handle() {
    // Written through one handle, checked through another: the handle's
    // metadata is what `open_regular` reports, and a regular file passes.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("note.md");
    let mut w = fs::File::create(&path).expect("create");
    w.write_all(b"12345678").expect("write");
    w.sync_all().expect("sync");
    let (_file, len) = open_regular(&path).expect("a regular file");
    assert_eq!(len, 8);
}

/// The branch the `fstat` size can never reach: a source whose reported size
/// passed the early check and which then yields MORE than the limit.
///
/// On a real file that is a race — the file grows between the `fstat` and the
/// read — so the existing oversized test cannot exercise it: its reported
/// length already exceeds the limit and it returns before this code runs.
/// Reading through the same helper from an in-memory source makes the refusal
/// deterministic. `io::repeat` never ends, so this also pins that the read is
/// BOUNDED rather than merely checked afterwards: an unbounded read here would
/// not fail the assertion, it would never return.
#[test]
fn a_source_that_yields_more_than_it_promised_is_refused_on_the_bytes_read() {
    let err = read_bounded_stream(std::io::repeat(b'a'), 100).expect_err("endless > 100");
    assert!(
        matches!(err, BoundedReadError::TooLarge { limit: 100 }),
        "{err:?}"
    );
}

#[test]
fn the_bounded_stream_accepts_exactly_the_limit_and_refuses_one_past_it() {
    assert_eq!(
        read_bounded_stream(&b"12345"[..], 5).expect("5 == the limit"),
        b"12345"
    );
    let err = read_bounded_stream(&b"123456"[..], 5).expect_err("6 > 5");
    assert!(
        matches!(err, BoundedReadError::TooLarge { limit: 5 }),
        "{err:?}"
    );
}
