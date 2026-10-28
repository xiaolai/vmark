// WI-AL1.2 — one-time migration of mcp-checkpoints.jsonl into legacyCheckpoint records: fixture JSONL, malformed and duplicate lines, CJK bytes, idempotent re-runs, crash mid-import, and the original kept until the migrated journal verifies
//! The fixture has seven non-blank lines: two well-formed checkpoints that
//! share an id (the newer line wins, as the frontend's loader does), a
//! checkpoint with CJK, emoji and combining marks on an untitled tab, an empty
//! checkpoint, a torn line, a lone-surrogate line and a line with no
//! `contentBefore`. The three malformed lines are skipped and counted: the
//! frontend already drops them, and the original file is kept regardless.

use std::path::{Path, PathBuf};

use super::legacy_import::{
    import_legacy_file, retire_legacy_file, LegacyImportReport, RetireError, RETIRED_SUFFIX,
};
use super::test_support::*;
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::record::LegacyAnchor;
use crate::agent_journal::writer::Writer;

const FIXTURE: &str =
    include_str!("../../../src/test/fixtures/agentJournal/legacyCheckpoints.jsonl");

fn write_fixture(dir: &Path, text: &str) -> PathBuf {
    let path = dir.join("mcp-checkpoints.jsonl");
    std::fs::write(&path, text).unwrap();
    path
}

fn line(id: &str, content: &str) -> String {
    serde_json::json!({
        "id": id, "tabId": "t", "filePath": null, "timestamp": 1, "tool": "document.write",
        "description": "", "contentBefore": content,
    })
    .to_string()
}

fn imported(w: &Writer, path: &Path) -> LegacyImportReport {
    import_legacy_file(w, path).expect("import")
}

#[test]
fn the_fixture_migrates_every_well_formed_checkpoint_once_and_verifies() {
    let data = tmp();
    let file = write_fixture(data.path(), FIXTURE);
    let journal = tmp();
    let (w, _) = open(journal.path());
    let report = imported(&w, &file);
    assert_eq!(
        report,
        LegacyImportReport {
            found: true,
            lines: 7,
            malformed: 3,
            checkpoints: 3,
            appended: 3,
            verified: true,
        }
    );
    let legacy = w.snapshot().state.legacy;
    assert_eq!(legacy.len(), 3);
    assert_eq!(legacy["cp-file"].description, "newest line wins");
    assert_eq!(legacy["cp-file"].timestamp, 1_760_000_002_000);
    assert_eq!(
        legacy["cp-file"].anchor,
        LegacyAnchor::FilePath {
            path: "/Users/someone/notes/plan.md".into()
        }
    );
    assert_eq!(
        legacy["cp-untitled"].anchor,
        LegacyAnchor::Tab {
            tab_id: "tab-2".into()
        }
    );
    assert_eq!(
        legacy["cp-empty"].description, "",
        "a missing description defaults to empty"
    );
    assert!(!legacy.contains_key("cp-torn") && !legacy.contains_key("cp-surrogate"));
}

#[test]
fn cjk_emoji_and_combining_marks_round_trip_byte_exact_across_reopen() {
    let data = tmp();
    let file = write_fixture(data.path(), FIXTURE);
    let journal = tmp();
    {
        let (w, _) = open(journal.path());
        imported(&w, &file);
    }
    let (w, _) = open(journal.path());
    let entry = w.snapshot().state.legacy["cp-untitled"].clone();
    let expected = "标题\n\n段落 🙂 e\u{301}\n";
    assert_eq!(entry.preimage, BlobHash::of_text(expected));
    assert_eq!(w.blob_text(&entry.preimage).unwrap(), expected);
    assert_eq!(
        w.blob_text(&BlobHash::of_text("")).unwrap(),
        "",
        "empty content is a real blob"
    );
}

#[test]
fn a_rerun_appends_nothing_and_a_later_line_is_picked_up() {
    let data = tmp();
    let file = write_fixture(data.path(), FIXTURE);
    let journal = tmp();
    let (w, _) = open(journal.path());
    imported(&w, &file);
    let len = w.journal_len();
    let again = imported(&w, &file);
    assert_eq!((again.appended, again.verified), (0, true));
    assert_eq!(w.journal_len(), len, "an idempotent re-run writes no byte");
    let mut text = FIXTURE.to_string();
    text.push_str(&line("cp-later", "later"));
    text.push('\n');
    std::fs::write(&file, text).unwrap();
    let later = imported(&w, &file);
    assert_eq!(
        (later.appended, later.checkpoints, later.verified),
        (1, 4, true)
    );
}

#[test]
fn the_original_file_is_left_byte_identical_by_the_import() {
    let data = tmp();
    let file = write_fixture(data.path(), FIXTURE);
    let journal = tmp();
    let (w, _) = open(journal.path());
    imported(&w, &file);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), FIXTURE);
}

#[test]
fn a_missing_file_is_not_found_and_an_empty_one_verifies_vacuously() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let missing = imported(&w, &data.path().join("mcp-checkpoints.jsonl"));
    assert_eq!(missing, LegacyImportReport::default());
    let empty = write_fixture(data.path(), "\n\n");
    let report = imported(&w, &empty);
    assert_eq!(
        (report.found, report.lines, report.verified),
        (true, 0, true)
    );
}

#[test]
fn an_id_already_in_the_journal_with_different_content_does_not_verify() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let file = write_fixture(data.path(), &format!("{}\n", line("cp-1", "old")));
    imported(&w, &file);
    std::fs::write(&file, format!("{}\n", line("cp-1", "rewritten"))).unwrap();
    let report = imported(&w, &file);
    assert_eq!(
        (report.appended, report.verified),
        (0, false),
        "first import of an id wins"
    );
    assert_eq!(
        retire_legacy_file(&file, &report).unwrap_err(),
        RetireError::NotVerified
    );
    assert!(
        file.exists(),
        "the original stays while the journal disagrees with it"
    );
}

#[test]
fn a_crash_mid_migration_is_repaired_by_the_next_run_without_duplicates() {
    let data = tmp();
    let journal = tmp();
    let (w, faults) = open(journal.path());
    let file = write_fixture(data.path(), &format!("{}\n", line("a", "1")));
    imported(&w, &file);
    let text = [line("a", "1"), line("b", "2"), line("c", "3")].join("\n");
    std::fs::write(&file, &text).unwrap();
    faults.fail_next_appends(1);
    let err = import_legacy_file(&w, &file).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_IO");
    let report = imported(&w, &file);
    assert_eq!(
        (report.appended, report.checkpoints, report.verified),
        (2, 3, true)
    );
    assert_eq!(w.snapshot().state.legacy.len(), 3);
}

#[test]
fn a_future_journal_stops_startup_before_the_import_and_keeps_the_file() {
    use crate::agent_journal::service::{start, JOURNAL_DIR};
    let data = tmp();
    {
        let (w, _) = open(&data.path().join(JOURNAL_DIR));
        let next = crate::agent_journal::record::MAX_SUPPORTED_SCHEMA + 1;
        let v = serde_json::json!({"schemaVersion": next, "seq": "99", "txn": crate::agent_journal::ids::TxnId::new(), "at": 0, "record": {"kind": "fromTheFuture"}});
        w.debug_append_raw(&serde_json::to_vec(&v).unwrap())
            .unwrap();
    }
    let file = write_fixture(data.path(), FIXTURE);
    let err = start(data.path()).err().expect("the journal stays off");
    assert!(err.is_future_format(), "{err}");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), FIXTURE);
}

#[test]
fn retirement_renames_only_a_verified_original_and_never_clobbers() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let missing = data.path().join("mcp-checkpoints.jsonl");
    let none = imported(&w, &missing);
    assert_eq!(
        retire_legacy_file(&missing, &none).unwrap_err(),
        RetireError::NotFound
    );

    let file = write_fixture(data.path(), FIXTURE);
    let report = imported(&w, &file);
    let retired = retire_legacy_file(&file, &report).unwrap();
    assert_eq!(
        retired,
        data.path()
            .join(format!("mcp-checkpoints.jsonl{RETIRED_SUFFIX}"))
    );
    assert!(!file.exists());
    assert_eq!(
        std::fs::read_to_string(&retired).unwrap(),
        FIXTURE,
        "renamed, never rewritten"
    );

    let file = write_fixture(data.path(), &format!("{}\n", line("cp-new", "x")));
    let report = imported(&w, &file);
    let second = retire_legacy_file(&file, &report).unwrap();
    assert_eq!(
        second,
        data.path()
            .join(format!("mcp-checkpoints.jsonl{RETIRED_SUFFIX}-2"))
    );
    assert_eq!(
        std::fs::read_to_string(&retired).unwrap(),
        FIXTURE,
        "an earlier retired copy is never overwritten"
    );
}

#[test]
fn a_line_of_invalid_utf8_is_malformed_and_its_neighbours_still_migrate() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let mut bytes = line("ok-1", "one").into_bytes();
    bytes.extend_from_slice(b"\n{\"id\":\"bad\xff\"}\n");
    bytes.extend_from_slice(line("ok-2", "two").as_bytes());
    let file = data.path().join("mcp-checkpoints.jsonl");
    std::fs::write(&file, bytes).unwrap();
    let report = imported(&w, &file);
    assert_eq!(
        (
            report.lines,
            report.malformed,
            report.checkpoints,
            report.verified
        ),
        (3, 1, 2, true)
    );
}

#[test]
fn a_line_the_panel_would_reject_is_malformed_not_imported() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let patched = |k: &str, v: serde_json::Value| {
        let mut l: serde_json::Value = serde_json::from_str(&line("p", "x")).unwrap();
        l[k] = v;
        l.to_string()
    };
    let lines = [
        line("ok-1", "一"),
        patched("id", "".into()),
        patched("tool", "".into()),
        patched("tabId", "".into()),
        patched("filePath", "".into()),
        patched("timestamp", 8_640_000_000_000_001u64.into()),
    ];
    let file = data.path().join("mcp-checkpoints.jsonl");
    std::fs::write(&file, lines.join("\n")).unwrap();
    let report = imported(&w, &file);
    assert_eq!(
        (report.lines, report.malformed, report.checkpoints),
        (6, 5, 1)
    );
}

#[test]
fn a_log_over_the_size_limit_is_refused_whole_and_left_in_place() {
    use super::legacy_import::import_legacy_file_within;
    let dir = tmp();
    let (w, _) = open(dir.path());
    let text = format!("{}\n", line("over", "中文"));
    let path = write_fixture(dir.path(), &text);
    let limit = text.len() as u64;
    // Exactly at the limit: imported.
    let at = import_legacy_file_within(&w, &path, limit).expect("at the limit");
    assert_eq!((at.appended, at.verified), (1, true));
    // One byte over: refused before anything is parsed or appended.
    std::fs::write(&path, format!("{text}{}\n", line("next", "x"))).unwrap();
    let before = w.journal_len();
    let err = import_legacy_file_within(&w, &path, limit).unwrap_err();
    assert_eq!(err.code(), "JOURNAL_IO");
    assert!(format!("{err:?}").contains("limit"), "{err:?}");
    assert_eq!(w.journal_len(), before, "nothing appended");
    assert!(path.exists(), "the original is kept");
}

#[test]
fn an_unreadable_archive_name_is_not_taken_for_a_vacant_one() {
    // A name the filesystem cannot even look up is an error, not "free".
    let dir = tmp();
    let (w, _) = open(dir.path());
    let long = "m".repeat(250);
    let path = dir.path().join(&long);
    std::fs::write(&path, format!("{}\n", line("a", "x"))).unwrap();
    let report = imported(&w, &path);
    assert!(report.verified);
    let err = retire_legacy_file(&path, &report).unwrap_err();
    assert!(
        matches!(err, RetireError::Io(ref m) if m.contains("archive")),
        "{err:?}"
    );
    assert!(path.exists(), "the original is kept");
}

#[test]
fn an_archive_created_just_before_the_claim_is_never_overwritten() {
    use super::legacy_import::{claim_archive, retire_with};
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let file = write_fixture(data.path(), FIXTURE);
    let report = imported(&w, &file);
    let first = data
        .path()
        .join(format!("mcp-checkpoints.jsonl{RETIRED_SUFFIX}"));
    let racing = |from: &Path, to: &Path| {
        if to == first {
            std::fs::write(to, "another process's archive 中文").unwrap();
        }
        claim_archive(from, to)
    };
    let retired = retire_with(&file, &report, racing).unwrap();
    assert_eq!(
        std::fs::read_to_string(&first).unwrap(),
        "another process's archive 中文",
        "the archive that appeared is kept"
    );
    assert_eq!(
        retired,
        data.path()
            .join(format!("mcp-checkpoints.jsonl{RETIRED_SUFFIX}-2"))
    );
    assert_eq!(std::fs::read_to_string(&retired).unwrap(), FIXTURE);
    assert!(!file.exists());
}

/// The archive path that `n` (1-based) names next to `file`.
fn archive(file: &Path, n: usize) -> PathBuf {
    let suffix = if n > 1 {
        format!("-{n}")
    } else {
        String::new()
    };
    file.with_file_name(format!("mcp-checkpoints.jsonl{RETIRED_SUFFIX}{suffix}"))
}

/// A `.migrated` symlink to the original is not an identical archive: the
/// original would be deleted and the link left dangling.
#[cfg(unix)]
#[test]
fn a_symlinked_archive_to_the_original_is_not_taken_for_a_copy() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let file = write_fixture(data.path(), FIXTURE);
    let report = imported(&w, &file);
    std::os::unix::fs::symlink(&file, archive(&file, 1)).unwrap();
    let retired = retire_legacy_file(&file, &report).unwrap();
    assert_eq!(retired, archive(&file, 2), "the next name is claimed");
    assert_eq!(std::fs::read_to_string(&retired).unwrap(), FIXTURE);
    assert!(std::fs::symlink_metadata(archive(&file, 1))
        .unwrap()
        .is_symlink());
}

/// An archive of another size is never read: one the user cannot read (or
/// a huge one) does not stop the original from retiring under the next name.
#[cfg(unix)]
#[test]
fn an_archive_of_another_size_is_skipped_unread() {
    use std::os::unix::fs::PermissionsExt;
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let file = write_fixture(data.path(), FIXTURE);
    let report = imported(&w, &file);
    let other = archive(&file, 1);
    std::fs::write(&other, "unrelated").unwrap();
    std::fs::set_permissions(&other, std::fs::Permissions::from_mode(0o000)).unwrap();
    let retired = retire_legacy_file(&file, &report);
    std::fs::set_permissions(&other, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(retired.unwrap(), archive(&file, 2));
    assert_eq!(std::fs::read_to_string(&other).unwrap(), "unrelated");
}

/// Same size is not same content: the comparison reads to the last byte.
#[test]
fn an_archive_of_the_same_size_with_other_bytes_is_kept() {
    let data = tmp();
    let journal = tmp();
    let (w, _) = open(journal.path());
    let file = write_fixture(data.path(), FIXTURE);
    let report = imported(&w, &file);
    let mut bytes = FIXTURE.as_bytes().to_vec();
    *bytes.last_mut().unwrap() ^= 1;
    std::fs::write(archive(&file, 1), &bytes).unwrap();
    std::fs::copy(&file, archive(&file, 2)).unwrap();
    let retired = retire_legacy_file(&file, &report).unwrap();
    assert_eq!(
        retired,
        archive(&file, 2),
        "the identical copy is the archive"
    );
    assert!(!file.exists());
    assert_eq!(std::fs::read(archive(&file, 1)).unwrap(), bytes);
}
