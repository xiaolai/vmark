//! Tests for `backup_io.rs` (included via `#[path]`).
//!
//! The backup is the only thing standing between a bad write and the user's
//! `~/.claude.json`. Every property here is one a real crash or a real
//! second install would otherwise violate.

use super::*;
use std::collections::HashSet;
use std::sync::{Arc, Barrier};
use std::thread;
use tempfile::tempdir;

/// A source file plus its directory, so tests can name a backup base exactly.
struct Fixture {
    dir: tempfile::TempDir,
    source: PathBuf,
}

fn fixture(contents: &str) -> Fixture {
    let dir = tempdir().unwrap();
    let source = dir.path().join("config.json");
    fs::write(&source, contents).unwrap();
    Fixture { dir, source }
}

impl Fixture {
    /// A fixed, test-owned backup base — no wall clock involved.
    fn base(&self) -> PathBuf {
        self.dir.path().join("config.json.backup.FIXED")
    }
}

// -- naming ----------------------------------------------------------------

#[test]
fn the_generated_base_sits_beside_the_config_and_is_marked_as_a_backup() {
    let path = Path::new("/home/u/.claude.json");
    let base = generate_backup_path(path);
    assert_eq!(base.parent(), path.parent());
    let name = base.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with(".claude.json.backup."), "got {name}");
}

#[test]
fn a_path_with_no_file_name_still_produces_a_base() {
    // `/` has no file name; the old code fell back to "config" rather than
    // panicking, and that fallback must stay.
    let base = generate_backup_path(Path::new("/"));
    let name = base.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("config.backup."), "got {name}");
}

// -- content and durability ------------------------------------------------

#[test]
fn backup_writes_the_given_bytes_whole_and_keeps_the_original() {
    let f = fixture("original");
    let backup = write_backup(&f.source, &f.base(), b"original").unwrap();

    assert_eq!(fs::read_to_string(&f.source).unwrap(), "original");
    assert_eq!(fs::read(&backup).unwrap(), b"original");
    // Length on disk, not just the read: a flush that never happened would
    // show up here as a short file.
    assert_eq!(
        fs::metadata(&backup).unwrap().len(),
        "original".len() as u64
    );
    assert_ne!(backup, f.source);
}

#[test]
fn a_large_backup_is_written_in_full() {
    // ~1 MiB crosses any plausible internal buffer, so a missing flush
    // truncates it. `~/.claude.json` really does reach this size.
    let blob = "x".repeat(1024 * 1024);
    let f = fixture(&blob);
    let backup = write_backup(&f.source, &f.base(), blob.as_bytes()).unwrap();
    assert_eq!(fs::metadata(&backup).unwrap().len(), blob.len() as u64);
    assert_eq!(fs::read_to_string(&backup).unwrap(), blob);
}

#[test]
fn backup_of_an_empty_config_is_an_empty_file_not_a_missing_one() {
    let f = fixture("");
    let backup = write_backup(&f.source, &f.base(), b"").unwrap();
    assert!(backup.exists());
    assert_eq!(fs::metadata(&backup).unwrap().len(), 0);
}

// -- permissions (finding 1) -----------------------------------------------

#[cfg(unix)]
#[test]
fn backup_inherits_a_private_source_mode_instead_of_defaulting_to_world_readable() {
    use std::os::unix::fs::PermissionsExt;

    for mode in [0o600, 0o640, 0o644, 0o400] {
        let f = fixture("secrets: {\"token\": \"hunter2\"}");
        fs::set_permissions(&f.source, fs::Permissions::from_mode(mode)).unwrap();

        let backup = write_backup(&f.source, &f.base(), b"secrets").unwrap();

        let got = fs::metadata(&backup).unwrap().permissions().mode() & 0o7777;
        assert_eq!(
            got, mode,
            "backup of a {mode:o} config must not be {got:o} — it holds the same paths, env values and tokens"
        );
    }
}

#[cfg(unix)]
#[test]
fn a_private_backup_is_never_briefly_world_readable() {
    // The mode is passed to `open(2)` at creation, so there is no window
    // between "file exists" and "file is 0600". Asserting the created mode
    // *before* any explicit chmod would require racing the syscall; instead
    // pin the invariant that makes the race impossible: creation mode is
    // never wider than the source mode.
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("private");
    fs::set_permissions(&f.source, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(source_mode(&f.source) & 0o7777, 0o600);

    let backup = write_backup(&f.source, &f.base(), b"private").unwrap();
    let got = fs::metadata(&backup).unwrap().permissions().mode() & 0o7777;
    assert_eq!(got & 0o077, 0, "group/other bits leaked: {got:o}");
}

// -- collisions (finding 4): deterministic, no wall clock ------------------

#[test]
fn a_free_base_name_is_used_as_is() {
    let f = fixture("v0");
    let backup = write_backup(&f.source, &f.base(), b"v0").unwrap();
    assert_eq!(backup, f.base());
}

#[test]
fn an_occupied_base_falls_through_to_suffix_1() {
    let f = fixture("v1");
    fs::write(f.base(), "an earlier backup").unwrap();

    let backup = write_backup(&f.source, &f.base(), b"v1").unwrap();

    assert_eq!(backup, with_suffix(&f.base(), 1));
    assert_eq!(
        fs::read_to_string(f.base()).unwrap(),
        "an earlier backup",
        "the earlier backup must survive byte-for-byte"
    );
    assert_eq!(fs::read_to_string(&backup).unwrap(), "v1");
}

#[test]
fn an_occupied_base_and_suffix_1_fall_through_to_suffix_2() {
    let f = fixture("v2");
    fs::write(f.base(), "gen0").unwrap();
    fs::write(with_suffix(&f.base(), 1), "gen1").unwrap();

    let backup = write_backup(&f.source, &f.base(), b"v2").unwrap();

    assert_eq!(backup, with_suffix(&f.base(), 2));
    assert_eq!(fs::read_to_string(f.base()).unwrap(), "gen0");
    assert_eq!(
        fs::read_to_string(with_suffix(&f.base(), 1)).unwrap(),
        "gen1"
    );
}

#[test]
fn exhausting_every_variant_errors_rather_than_clobbering_one() {
    let f = fixture("vN");
    fs::write(f.base(), "gen0").unwrap();
    for i in 1..MAX_BACKUP_ATTEMPTS {
        fs::write(with_suffix(&f.base(), i), format!("gen{i}")).unwrap();
    }

    let err = write_backup(&f.source, &f.base(), b"vN")
        .expect_err("with every variant taken there is nowhere safe to write");
    assert!(err.contains("already exist"), "unexpected: {err}");

    assert_eq!(fs::read_to_string(f.base()).unwrap(), "gen0");
    for i in 1..MAX_BACKUP_ATTEMPTS {
        assert_eq!(
            fs::read_to_string(with_suffix(&f.base(), i)).unwrap(),
            format!("gen{i}"),
            "variant {i} was clobbered by the exhaustion path"
        );
    }
}

#[test]
fn concurrent_backups_sharing_one_base_all_survive() {
    // `create_new` is the atomicity guarantee; a check-then-create would let
    // two threads pick the same name and one would lose its backup.
    const THREADS: usize = 8;
    let f = fixture("shared");
    let base = f.base();
    let source = f.source.clone();
    let barrier = Arc::new(Barrier::new(THREADS));

    let handles: Vec<_> = (0..THREADS)
        .map(|i| {
            let (base, source, barrier) = (base.clone(), source.clone(), Arc::clone(&barrier));
            thread::spawn(move || {
                barrier.wait();
                let body = format!("thread-{i}");
                let path = write_backup(&source, &base, body.as_bytes()).unwrap();
                (path, body)
            })
        })
        .collect();

    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let unique: HashSet<_> = results.iter().map(|(p, _)| p.clone()).collect();
    assert_eq!(unique.len(), THREADS, "two threads shared a backup path");
    for (path, body) in &results {
        assert_eq!(&fs::read_to_string(path).unwrap(), body);
    }
}

#[test]
fn the_timestamped_wrapper_writes_the_config_that_is_on_disk() {
    let f = fixture("live content");
    let backup = backup_config_file(&f.source, b"live content").unwrap();
    assert_eq!(fs::read_to_string(&backup).unwrap(), "live content");
    let name = backup.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("config.json.backup."), "got {name}");
}
