//! A save older than one already published to its file is refused, whoever
//! asked for either; a file never written is not refused unless its record
//! may have been forgotten, a failed save records nothing, and the refusal
//! names the newest save it lost to.
//!
//! Edge cases: an equal sequence (another window's), sequence 0 and past JavaScript's safe
//! integers, an unknown field on the wire, a CJK path, the floor left by an
//! entry dropped at capacity, a file published again kept over older
//! entries, a symlink and its referent through the write
//! core (Unix).

use super::{check, record, validate, SaveOrder, CAPACITY};
use crate::command_error::ErrorCode;
use std::path::Path;
use std::sync::Mutex;

/// The record is process-wide and bounded: the capacity test raises the
/// floor every other test would meet, so these run one at a time and each
/// uses sequences above anything recorded before it.
static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn unique(stem: &str) -> String {
    format!("{stem}-{}", uuid::Uuid::new_v4())
}

/// A sequence above every one a test has recorded so far.
fn fresh() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1 << 40);
    NEXT.fetch_add(1 << 20, Ordering::SeqCst)
}

fn order(seq: u64) -> SaveOrder {
    SaveOrder { seq }
}

const TARGET: &str = "/文档/笔记.md";

#[test]
fn an_older_save_is_refused_once_a_newer_one_published_to_its_file() {
    let _s = serial();
    let (file, base) = (unique("file"), fresh());
    record(&file, &order(base + 5));

    let err = check(&file, &order(base + 4), Path::new(TARGET)).expect_err("older is refused");
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.save.superseded"));
    let detail = err.detail().expect("structured detail");
    assert_eq!(detail["kind"], "superseded");
    assert_eq!(detail["path"], TARGET);
    assert_eq!(detail["newest"], base + 5);
    assert_eq!(detail["recorded"], true);

    // One webview never issues a sequence twice: an equal one is another
    // window's, asked for in the same millisecond, and the file keeps the
    // first to publish.
    assert!(
        check(&file, &order(base + 5), Path::new(TARGET)).is_err(),
        "equal is refused"
    );
    assert!(check(&file, &order(base + 6), Path::new(TARGET)).is_ok());
}

#[test]
fn another_file_is_never_refused() {
    let _s = serial();
    let base = fresh();
    record(&unique("file"), &order(base + 9));
    assert!(check(&unique("other-file"), &order(base + 1), Path::new(TARGET)).is_ok());
}

#[test]
fn a_later_record_never_lowers_what_was_published() {
    let _s = serial();
    let (file, base) = (unique("file"), fresh());
    record(&file, &order(base + 7));
    record(&file, &order(base + 3));
    assert!(check(&file, &order(base + 6), Path::new(TARGET)).is_err());
}

#[test]
fn a_dropped_entry_leaves_a_floor_that_refuses_older_saves_anywhere() {
    let _s = serial();
    let (first, base) = (unique("first"), fresh());
    record(&first, &order(base + 2));
    for _ in 0..CAPACITY {
        record(&unique("filler"), &order(base + 1));
    }
    // `first` was forgotten: a save older than it may still be on its way,
    // to it or to any other file, so it is refused rather than let through.
    for file in [first.clone(), unique("never-written")] {
        let err = check(&file, &order(base + 1), Path::new(TARGET)).expect_err("below the floor");
        let detail = err.detail().expect("detail");
        assert_eq!(detail["newest"], base + 2);
        // The floor names a save, but not one published to this file.
        assert_eq!(detail["recorded"], false);
    }
    assert!(check(&first, &order(base + 3), Path::new(TARGET)).is_ok());
    assert!(check(
        &unique("never-written"),
        &order(base + 3),
        Path::new(TARGET)
    )
    .is_ok());
}

#[test]
fn a_file_published_again_is_dropped_last() {
    let _s = serial();
    let (busy, base) = (unique("busy"), fresh());
    record(&busy, &order(base + 2));
    for _ in 1..CAPACITY {
        record(&unique("filler"), &order(base + 1));
    }
    record(&busy, &order(base + 3));
    record(&unique("one-more"), &order(base + 1));
    // A filler was dropped, not `busy`: the floor is the filler's sequence,
    // so a file never written may still take a save asked for before `busy`.
    assert!(check(
        &unique("never-written"),
        &order(base + 2),
        Path::new(TARGET)
    )
    .is_ok());
    let err = check(&busy, &order(base + 2), Path::new(TARGET)).expect_err("busy kept");
    assert_eq!(err.detail().expect("detail")["newest"], base + 3);
}

#[test]
fn an_order_the_webview_could_not_have_issued_is_invalid_input() {
    let max = (1u64 << 53) - 1;
    for bad in [order(0), order(max + 1)] {
        let err = validate(&bad).expect_err("refused");
        assert_eq!(err.code(), ErrorCode::InvalidInput, "{bad:?}");
    }
    for good in [order(1), order(max)] {
        assert!(validate(&good).is_ok(), "{good:?}");
    }
}

#[test]
fn the_wire_shape_is_exactly_seq() {
    let ok: SaveOrder = serde_json::from_value(serde_json::json!({ "seq": 3 })).unwrap();
    assert_eq!(ok, order(3));
    for bad in [
        serde_json::json!({ "doc": "w", "seq": 1 }),
        serde_json::json!({ "seq": -1 }),
        serde_json::json!({}),
    ] {
        assert!(serde_json::from_value::<SaveOrder>(bad).is_err());
    }
}

#[cfg(unix)]
mod through_the_write_core {
    use super::{fresh, order, serial};
    use crate::command_error::{CommandError, ErrorCode};
    use crate::files::write::{write_ordered, Publish};
    use std::fs;

    #[test]
    fn an_older_save_through_a_symlink_cannot_overwrite_a_newer_one_through_its_referent() {
        let _s = serial();
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("真的.md");
        let link = dir.path().join("link.md");
        fs::write(&real, "zero").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let base = fresh();

        write_ordered(
            &real,
            "new",
            Publish::Replace,
            Some(&order(base + 2)),
            |_| Ok(()),
        )
        .unwrap();
        let err = write_ordered(
            &link,
            "old",
            Publish::Replace,
            Some(&order(base + 1)),
            |_| Ok(()),
        )
        .expect_err("the older save is refused");
        assert_eq!(err.i18n_key(), Some("errors.save.superseded"));
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());

        write_ordered(
            &link,
            "newer",
            Publish::Replace,
            Some(&order(base + 3)),
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&real).unwrap(), "newer");
    }

    #[test]
    fn a_refused_save_records_nothing() {
        let _s = serial();
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.md");
        let base = fresh();
        let refused = write_ordered(
            &target,
            "x",
            Publish::Replace,
            Some(&order(base + 5)),
            |_| Err(CommandError::invalid_input("no")),
        );
        assert_eq!(refused.unwrap_err().code(), ErrorCode::InvalidInput);
        write_ordered(
            &target,
            "y",
            Publish::Replace,
            Some(&order(base + 4)),
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "y");
    }

    #[test]
    fn a_save_with_no_order_is_never_refused() {
        let _s = serial();
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.md");
        write_ordered(
            &target,
            "new",
            Publish::Replace,
            Some(&order(fresh())),
            |_| Ok(()),
        )
        .unwrap();
        write_ordered(&target, "plain", Publish::Replace, None, |_| Ok(())).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "plain");
    }
}
