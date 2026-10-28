// WI-AL4.1 — the export state file: a disk failure reading or writing it is an I/O error (not an internal one) that keeps its exportCode, a corrupt file stays a journal error, and saving goes through a fresh private temp file that a stale fixed-name leftover cannot block
use super::*;
use crate::agent_journal::test_support::tmp;
use crate::command_error::{CommandError, ErrorCode};

fn expected() -> Expected {
    Expected {
        commit: "c1".into(),
        pending: None,
    }
}

fn class_and_code(e: ExportError) -> (ErrorCode, String) {
    let c = CommandError::from(e);
    let code = c.detail().expect("detail")["exportCode"]
        .as_str()
        .expect("exportCode")
        .to_owned();
    (c.code(), code)
}

#[test]
fn an_unreadable_state_file_is_an_io_error() {
    let root = tmp();
    // A directory where the file belongs: reading it fails at the OS.
    let state = ExportState::at(root.path().to_path_buf());
    let err = state.expected(DocId::new(), "/r").expect_err("unreadable");
    assert_eq!(class_and_code(err), (ErrorCode::Io, "JOURNAL_ERROR".into()));
}

#[test]
fn an_unwritable_state_file_is_an_io_error() {
    let root = tmp();
    let state = ExportState::in_dir(&root.path().join("missing-dir"));
    let err = state
        .store(DocId::new(), "/r", expected())
        .expect_err("no directory");
    assert_eq!(class_and_code(err), (ErrorCode::Io, "JOURNAL_ERROR".into()));
}

#[test]
fn a_corrupt_state_file_stays_a_journal_error() {
    let root = tmp();
    std::fs::write(root.path().join(STATE_FILE), "{").expect("write");
    let err = ExportState::in_dir(root.path())
        .expected(DocId::new(), "/r")
        .expect_err("corrupt");
    assert_eq!(
        class_and_code(err),
        (ErrorCode::Internal, "JOURNAL_ERROR".into())
    );
}

#[test]
fn a_stale_fixed_name_temp_file_does_not_block_a_save() {
    let root = tmp();
    let path = root.path().join(STATE_FILE);
    // A leftover (here a directory) at the old predictable temp name.
    std::fs::create_dir(path.with_extension("json.tmp")).expect("plant");
    let (state, doc) = (ExportState::at(path.clone()), DocId::new());
    state.store(doc, "/r", expected()).expect("saved");
    assert_eq!(state.expected(doc, "/r").expect("read"), Some(expected()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).expect("meta").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "private");
    }
}
