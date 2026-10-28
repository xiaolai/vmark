// WI-AL1.2 — the legacy import's edges: the largest size cap reads the whole log, and a path whose existence cannot be checked is an I/O failure, never "not found"
//! Edge cases: a cap of `u64::MAX` (one past it does not exist); a path
//! under a regular file, where the existence check itself fails.

use crate::agent_journal::legacy_import::import_legacy_file_within;
use crate::agent_journal::test_support::*;

#[test]
fn the_largest_size_cap_reads_the_whole_log() {
    let dir = tmp();
    let (w, _) = open(dir.path());
    let path = dir.path().join("mcp-checkpoints.jsonl");
    let line = serde_json::json!({
        "id": "a", "tabId": "t", "filePath": null, "timestamp": 1, "tool": "document.write",
        "description": "", "contentBefore": "中文",
    });
    std::fs::write(&path, format!("{line}\n")).unwrap();
    let report = import_legacy_file_within(&w, &path, u64::MAX).expect("import");
    assert_eq!((report.appended, report.verified), (1, true));
}

// Windows reports a path under a regular file as absent, not as a failure.
#[cfg(unix)]
#[test]
fn a_path_whose_existence_cannot_be_checked_is_an_io_failure() {
    use crate::agent_journal::legacy_import::{
        retire_legacy_file, LegacyImportReport, RetireError,
    };
    let dir = tmp();
    let file = dir.path().join("plain");
    std::fs::write(&file, "x").unwrap();
    let path = file.join("mcp-checkpoints.jsonl");
    let report = LegacyImportReport {
        found: true,
        verified: true,
        ..LegacyImportReport::default()
    };
    let err = retire_legacy_file(&path, &report).unwrap_err();
    assert!(matches!(err, RetireError::Io(_)), "{err:?}");
}
