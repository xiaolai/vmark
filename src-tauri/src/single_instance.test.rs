//! Tests for second-launch argv handling (#1330).
//!
//! Only the argv→files decision is unit-testable without a live app; the
//! window-surfacing half needs a real `AppHandle`. That split is deliberate:
//! the argv half is where a silent mistake hides (a dropped `skip(1)` opens the
//! executable; a missing filter opens a `.exe` as a document), while the
//! surfacing half fails loudly and visibly the first time anyone tries it.

use super::openable_files_from_argv;

/// Real files on disk — `filter_supported_args` calls `is_file()`, so a
/// fabricated path would be rejected for the wrong reason and the test would
/// pass no matter what the filter did.
struct Fixture {
    dir: std::path::PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("vmark-single-instance-{tag}"));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self { dir }
    }

    fn file(&self, name: &str) -> String {
        let path = self.dir.join(name);
        std::fs::write(&path, b"# doc\n").expect("write fixture file");
        path.to_string_lossy().into_owned()
    }

    fn subdir(&self, name: &str) -> String {
        let path = self.dir.join(name);
        std::fs::create_dir_all(&path).expect("create fixture subdir");
        path.to_string_lossy().into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn empty_argv_asks_for_nothing() {
    assert!(openable_files_from_argv(Vec::new()).is_empty());
}

#[test]
fn a_bare_launch_carries_no_files() {
    // Double-clicking the app icon while VMark is already running.
    assert!(openable_files_from_argv(vec!["C:/Program Files/VMark/vmark.exe".into()]).is_empty());
}

#[test]
fn forwards_the_supported_files_after_argv0() {
    let fx = Fixture::new("forwards");
    let note = fx.file("note.md");
    let data = fx.file("data.yaml");

    let files =
        openable_files_from_argv(vec!["/opt/vmark/vmark".into(), note.clone(), data.clone()]);

    assert_eq!(files, vec![note, data]);
}

#[test]
fn argv0_is_dropped_before_the_gate_not_after() {
    // The regression a missing `skip(1)` produces. argv[0] is a REAL openable
    // file here, so the filter alone cannot reject it — only the skip can. A
    // contrived program name, but the failure it guards (opening the program
    // itself as a document) is the same one a `.md`-suffixed launcher causes.
    let fx = Fixture::new("argv0");
    let program = fx.file("vmark.md");
    let note = fx.file("note.md");

    let files = openable_files_from_argv(vec![program, note.clone()]);

    assert_eq!(files, vec![note]);
}

#[test]
fn drops_paths_this_app_cannot_open() {
    let fx = Fixture::new("drops");
    let note = fx.file("note.md");
    let binary = fx.file("installer.exe");
    let folder = fx.subdir("a-folder");
    let missing = fx.dir.join("gone.md").to_string_lossy().into_owned();

    let files = openable_files_from_argv(vec![
        "/opt/vmark/vmark".into(),
        binary,
        folder,
        missing,
        note.clone(),
    ]);

    // A directory is dropped rather than opened as a workspace: that matches
    // the cold-start CLI path in `app_setup`, which filters argv identically.
    // Changing it is a product decision, and it belongs in both places at once.
    assert_eq!(files, vec![note]);
}
