// WI-AL1.6 — startup retires mcp-checkpoints.jsonl only after a verified import: the original moves aside to .migrated (never rewritten, never overwriting an earlier archive), a restart is idempotent (nothing to import, nothing to retire, every checkpoint still in the journal), an unverified import or a failed one keeps the original where it is, and the status says which
use super::legacy_import::{
    retire_legacy_file, LegacyImportReport, LEGACY_CHECKPOINT_FILE, RETIRED_SUFFIX,
};
use super::service::{start, LegacyRetirement};
use super::test_support::*;

const FIXTURE: &str =
    include_str!("../../../src/test/fixtures/agentJournal/legacyCheckpoints.jsonl");

fn line(id: &str, content: &str) -> String {
    serde_json::json!({
        "id": id, "tabId": "t", "filePath": null, "timestamp": 1, "tool": "document.write",
        "description": "", "contentBefore": content,
    })
    .to_string()
}

fn archive(dir: &std::path::Path, n: usize) -> std::path::PathBuf {
    let suffix = if n == 1 {
        RETIRED_SUFFIX.to_string()
    } else {
        format!("{RETIRED_SUFFIX}-{n}")
    };
    dir.join(format!("{LEGACY_CHECKPOINT_FILE}{suffix}"))
}

#[test]
fn startup_retires_a_verified_log_and_a_restart_is_idempotent() {
    let app_data = tmp();
    let legacy = app_data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(&legacy, FIXTURE).unwrap();
    let first = start(app_data.path()).expect("start");
    assert_eq!(
        first.retirement,
        LegacyRetirement::Retired {
            to: format!("{LEGACY_CHECKPOINT_FILE}{RETIRED_SUFFIX}")
        }
    );
    assert!(!legacy.exists(), "the original is moved aside");
    assert_eq!(
        std::fs::read_to_string(archive(app_data.path(), 1)).unwrap(),
        FIXTURE,
        "renamed, never rewritten"
    );
    drop(first);
    let second = start(app_data.path()).expect("restart");
    assert_eq!(
        second.retirement,
        LegacyRetirement::Absent,
        "idempotent: nothing left to retire"
    );
    assert_eq!(
        second.legacy.clone().unwrap(),
        LegacyImportReport::default()
    );
    assert_eq!(
        second.writer.snapshot().state.legacy.len(),
        3,
        "every checkpoint stays in the journal"
    );
}

#[test]
fn an_unverified_import_keeps_the_original_in_place() {
    let app_data = tmp();
    let legacy = app_data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(&legacy, format!("{}\n", line("cp-1", "old"))).unwrap();
    drop(start(app_data.path()).expect("start"));
    // The original came back with a different text under the same id: the
    // journal (first import wins) does not hold it, so it is not verified.
    std::fs::write(&legacy, format!("{}\n", line("cp-1", "rewritten"))).unwrap();
    let again = start(app_data.path()).expect("restart");
    assert_eq!(again.retirement, LegacyRetirement::NotVerified);
    assert_eq!(
        std::fs::read_to_string(&legacy).unwrap(),
        format!("{}\n", line("cp-1", "rewritten"))
    );
}

#[test]
fn a_failed_import_keeps_the_original_and_says_why() {
    let app_data = tmp();
    std::fs::create_dir(app_data.path().join(LEGACY_CHECKPOINT_FILE)).unwrap();
    let started = start(app_data.path()).expect("journal still opens");
    assert!(matches!(started.retirement, LegacyRetirement::Kept { .. }));
    assert!(app_data.path().join(LEGACY_CHECKPOINT_FILE).is_dir());
}

#[test]
fn an_identical_earlier_archive_is_kept_and_the_original_removed() {
    let app_data = tmp();
    let legacy = app_data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(&legacy, FIXTURE).unwrap();
    drop(start(app_data.path()).expect("start"));
    // A crash between an earlier archive write and the original's removal
    // leaves both, byte-identical: retiring again is idempotent.
    std::fs::write(&legacy, FIXTURE).unwrap();
    let again = start(app_data.path()).expect("restart");
    assert_eq!(
        again.retirement,
        LegacyRetirement::Retired {
            to: format!("{LEGACY_CHECKPOINT_FILE}{RETIRED_SUFFIX}")
        }
    );
    assert!(!legacy.exists());
    assert!(
        !archive(app_data.path(), 2).exists(),
        "no duplicate archive"
    );
}

#[test]
fn a_different_earlier_archive_is_never_overwritten() {
    let app_data = tmp();
    let legacy = app_data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(archive(app_data.path(), 1), "an older archive\n").unwrap();
    std::fs::write(&legacy, FIXTURE).unwrap();
    let started = start(app_data.path()).expect("start");
    assert_eq!(
        started.retirement,
        LegacyRetirement::Retired {
            to: format!("{LEGACY_CHECKPOINT_FILE}{RETIRED_SUFFIX}-2")
        }
    );
    assert_eq!(
        std::fs::read_to_string(archive(app_data.path(), 1)).unwrap(),
        "an older archive\n"
    );
    assert_eq!(
        std::fs::read_to_string(archive(app_data.path(), 2)).unwrap(),
        FIXTURE
    );
}

#[test]
fn retiring_without_a_verified_report_is_refused_directly() {
    let data = tmp();
    let file = data.path().join(LEGACY_CHECKPOINT_FILE);
    std::fs::write(&file, "x\n").unwrap();
    let not_verified = LegacyImportReport {
        found: true,
        verified: false,
        ..LegacyImportReport::default()
    };
    assert!(retire_legacy_file(&file, &not_verified).is_err());
    assert!(file.exists());
}
