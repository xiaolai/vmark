//! The missing-destination fixture, and the refusal both cases expect.
//!
//! Purpose: `scenarios::bad_path` and `progress_case::refused` each built their
//! own scratch directory, invoked the renderer against it, and classified the
//! result — the same four rules written twice (audit 20260907 #251), which is
//! how one of them ends up asserting something the other does not.
//!
//! Both copies also named the scratch directory after the PROCESS ID and then
//! guarded it with `exists()` (#253). That guard is real — a leftover directory
//! would make the destination VALID, and the case would render and fail for a
//! reason it does not name — but the guard is a failure, not a fix: pids are
//! reused, so one crashed run leaves the case red on every later run with that
//! pid until someone empties the temp directory by hand.
//!
//! A live `TempDir` cannot collide with anything: the name is fresh, the OS
//! guarantees it did not exist, and the CHILD this points at is guaranteed
//! absent because nothing has created it. The guard is gone because the
//! condition it guarded against cannot arise.
//!
//! @coordinates-with scenarios.rs — `bad_path`
//! @coordinates-with progress_case.rs — `refused`
//! @module bin/pdf_smoke/missing_path

use std::path::PathBuf;

use vmark_lib::command_error::{CommandError, ErrorCode};

/// A `.pdf` destination whose PARENT directory does not exist.
///
/// The temp root is held for the fixture's lifetime — dropping it removes the
/// root and would make the path missing for the wrong reason.
pub struct MissingParent {
    _root: tempfile::TempDir,
    pub path: PathBuf,
}

/// Build one, or say why not. An absolute path with an absent parent — and
/// absolute matters: a POSIX literal like `/no/such/dir` is root-RELATIVE on
/// Windows, so validation refuses it at the is-absolute check and never reaches
/// the missing-directory guard these cases exist to exercise.
pub fn missing_parent() -> std::io::Result<MissingParent> {
    let root = tempfile::tempdir()?;
    let path = root.path().join("no-such-dir").join("x.pdf");
    Ok(MissingParent { _root: root, path })
}

/// Did the renderer refuse UP FRONT, the way the guard must?
///
/// `Ok(())` means yes. `Err(why)` is the transcript fragment naming what
/// happened instead — a refusal from somewhere else (a timeout here means the
/// print operation STARTED, which on macOS is how four blank pages once reached
/// a real printer), or an acceptance.
pub fn refusal_verdict(result: Result<(), CommandError>) -> Result<(), String> {
    match result {
        Err(e) if e.code() == ErrorCode::NotFound => Ok(()),
        Err(e) => Err(format!("refused late, code={:?}", e.code())),
        Ok(()) => Err("accepted an impossible path".to_string()),
    }
}
