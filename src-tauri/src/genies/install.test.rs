//! WI-FL5.3 — `install_default_genies` never overwrites a user's file.
//!
//! The installer runs on every launch (`app_setup.rs`), so "skip what already
//! exists" is the property that keeps an edited genie alive across updates.
//! Exercised through `install_default_genies_into` on a temp directory; the
//! command wrapper only resolves the directory.

use super::{
    claim_no_clobber, default_genie_names, install_default_genies_into, publish_no_clobber,
    publish_with, DEFAULT_GENIES,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn md_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).expect("read_dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            out.extend(md_files(&path));
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path);
        }
    }
    out
}

#[test]
fn a_fresh_install_writes_every_bundled_genie_byte_for_byte() {
    let base = tempfile::tempdir().expect("tempdir");
    install_default_genies_into(base.path()).expect("fresh install");

    for genie in DEFAULT_GENIES {
        let on_disk = fs::read_to_string(base.path().join(genie.path))
            .unwrap_or_else(|e| panic!("{} not installed: {e}", genie.path));
        assert_eq!(
            on_disk, genie.content,
            "{} differs from the bundle",
            genie.path
        );
    }
    assert_eq!(
        md_files(base.path()).len(),
        DEFAULT_GENIES.len(),
        "nothing beyond the bundled set is written"
    );
    assert!(
        stray_files(base.path()).is_empty(),
        "no temp file survives a publish: {:?}",
        stray_files(base.path())
    );
}

/// Every file under `dir` that is not a bundled `.md` — a temp file a publish
/// left behind would show up here.
fn stray_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).expect("read_dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            out.extend(stray_files(&path));
        } else if path.extension().is_none_or(|e| e != "md") {
            out.push(path);
        }
    }
    out
}

// ── #153: the final name never holds partial content ────────────────────────

#[test]
fn publish_refuses_an_existing_target_and_leaves_no_temp_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    fs::write(&target, "USER EDITED").expect("pre-write");
    publish_no_clobber(&target, b"BUNDLED").expect("an existing target is not an error");
    assert_eq!(fs::read_to_string(&target).expect("read"), "USER EDITED");
    assert!(
        stray_files(dir.path()).is_empty(),
        "{:?}",
        stray_files(dir.path())
    );
}

#[test]
fn publish_writes_a_fresh_target_whole_and_cleans_its_temp_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    publish_no_clobber(&target, b"BUNDLED").expect("fresh");
    assert_eq!(fs::read_to_string(&target).expect("read"), "BUNDLED");
    assert!(
        stray_files(dir.path()).is_empty(),
        "{:?}",
        stray_files(dir.path())
    );
}

#[test]
fn publish_into_a_missing_directory_is_an_error_naming_it_and_writes_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("no-such-dir").join("polish.md");
    let err = publish_no_clobber(&target, b"BUNDLED").expect_err("no parent");
    assert!(err.contains("no-such-dir"), "got: {err}");
    assert!(!target.exists());
}

#[test]
fn an_existing_genie_is_left_exactly_as_the_user_wrote_it() {
    let base = tempfile::tempdir().expect("tempdir");
    let edited = base.path().join(DEFAULT_GENIES[0].path);
    fs::create_dir_all(edited.parent().expect("category dir")).expect("mkdir");
    fs::write(&edited, "USER EDITED — must survive").expect("pre-write");

    install_default_genies_into(base.path())
        .expect("install over an existing file is not an error");

    assert_eq!(
        fs::read_to_string(&edited).expect("read"),
        "USER EDITED — must survive"
    );
    // The rest of the bundle still lands around it.
    for genie in &DEFAULT_GENIES[1..] {
        assert!(
            base.path().join(genie.path).is_file(),
            "{} missing",
            genie.path
        );
    }
}

#[test]
fn reinstalling_over_edited_genies_rewrites_none_of_them() {
    let base = tempfile::tempdir().expect("tempdir");
    install_default_genies_into(base.path()).expect("first install");
    for genie in DEFAULT_GENIES {
        let path = base.path().join(genie.path);
        fs::write(&path, format!("{}\n(edited)\n", genie.content)).expect("edit");
    }

    install_default_genies_into(base.path()).expect("second install");

    for genie in DEFAULT_GENIES {
        let on_disk = fs::read_to_string(base.path().join(genie.path)).expect("read");
        assert!(
            on_disk.ends_with("(edited)\n"),
            "{} was rewritten by the second install",
            genie.path
        );
    }
}

#[test]
fn a_file_squatting_on_a_category_directory_is_an_error_not_a_clobber() {
    let base = tempfile::tempdir().expect("tempdir");
    let category = Path::new(DEFAULT_GENIES[0].path)
        .parent()
        .expect("bundled genies live in a category dir");
    let squatter = base.path().join(category);
    fs::write(&squatter, "keep").expect("pre-write a FILE where the directory must go");

    let err = install_default_genies_into(base.path()).expect_err("cannot create the directory");
    assert!(err.contains("Failed to create dir"), "got: {err}");
    assert!(
        squatter.is_file(),
        "the squatting file must not be replaced"
    );
    assert_eq!(fs::read_to_string(&squatter).expect("read"), "keep");
}

// ── #152 / #154: what may sit where a genie goes ─────────────────────────────

#[cfg(unix)]
#[test]
fn a_category_directory_that_links_outside_the_genies_dir_is_refused() {
    let base = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("outside");
    let category = Path::new(DEFAULT_GENIES[0].path)
        .parent()
        .expect("bundled genies live in a category dir");
    std::os::unix::fs::symlink(outside.path(), base.path().join(category)).expect("symlink");

    let err = install_default_genies_into(base.path()).expect_err("must not follow the link out");
    assert!(err.contains("outside the genies directory"), "got: {err}");
    assert!(
        fs::read_dir(outside.path())
            .expect("read_dir")
            .next()
            .is_none(),
        "nothing may be written where the link points"
    );
}

#[test]
fn a_directory_squatting_on_a_genies_name_is_an_error_not_an_install() {
    let base = tempfile::tempdir().expect("tempdir");
    let squatter = base.path().join(DEFAULT_GENIES[0].path);
    fs::create_dir_all(&squatter).expect("mkdir where the genie goes");

    let err = install_default_genies_into(base.path()).expect_err("a directory is not a genie");
    assert!(err.contains("not a regular file"), "got: {err}");
    assert!(
        squatter.is_dir(),
        "the squatter is reported, never replaced"
    );
}

#[cfg(unix)]
#[test]
fn a_dangling_link_at_a_genies_name_is_an_error_not_an_install() {
    let base = tempfile::tempdir().expect("tempdir");
    let target = base.path().join(DEFAULT_GENIES[0].path);
    fs::create_dir_all(target.parent().expect("category dir")).expect("mkdir");
    std::os::unix::fs::symlink(base.path().join("nowhere.md"), &target).expect("symlink");

    let err = install_default_genies_into(base.path()).expect_err("a dangling link is not a genie");
    // A link is reported as a link whether or not it resolves (#154).
    assert!(err.contains("symbolic link"), "got: {err}");
}

#[cfg(unix)]
#[test]
fn a_link_at_a_genies_name_is_reported_not_counted_as_installed() {
    // #154: the scanner never follows links, so a link here is a genie the
    // picker cannot list. It is reported — and left exactly as it was.
    let base = tempfile::tempdir().expect("tempdir");
    let real = base.path().join("mine.md");
    fs::write(&real, "USER'S OWN").expect("write");
    let target = base.path().join(DEFAULT_GENIES[0].path);
    fs::create_dir_all(target.parent().expect("category dir")).expect("mkdir");
    std::os::unix::fs::symlink(&real, &target).expect("symlink");

    let err = install_default_genies_into(base.path()).expect_err("a link is not a genie");
    assert!(err.contains("symbolic link"), "got: {err}");
    assert!(
        fs::symlink_metadata(&target).expect("stat").is_symlink(),
        "the link is reported, never replaced"
    );
    assert_eq!(fs::read_to_string(&real).expect("read"), "USER'S OWN");
}

#[test]
fn one_squatter_does_not_keep_the_rest_of_the_bundle_out() {
    // The loop used to stop at the first problem, so a single squatter left
    // every genie after it uninstalled as well.
    let base = tempfile::tempdir().expect("tempdir");
    let squatter = base.path().join(DEFAULT_GENIES[0].path);
    fs::create_dir_all(&squatter).expect("mkdir where the genie goes");

    let err = install_default_genies_into(base.path()).expect_err("the squatter is reported");
    assert!(err.contains("not a regular file"), "got: {err}");
    for genie in &DEFAULT_GENIES[1..] {
        assert_eq!(
            fs::read_to_string(base.path().join(genie.path)).expect("installed"),
            genie.content,
            "{} must still land",
            genie.path
        );
    }
}

// ── #153: the claim itself refuses an existing target ────────────────────────
//
// `publish_with` runs its `claim` after every check the installer makes
// (`install_one`'s `symlink_metadata` shortcut precedes `publish_no_clobber`),
// so a `claim` that first plants something at the name and then calls
// `claim_no_clobber` — the claim production itself uses, not a no-clobber the
// test handed to itself — is exactly a genie created in that window.

#[test]
fn a_genie_created_between_the_check_and_the_publish_survives_the_publish() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    publish_with(&target, b"BUNDLED", |temp, to| {
        // The user's file lands AFTER the installer checked and found nothing.
        fs::write(to, "USER EDITED").expect("the concurrent creator wins the name");
        claim_no_clobber(temp, to)
    })
    .expect("a regular file at the name counts as installed, not as an error");
    assert_eq!(
        fs::read_to_string(&target).expect("read"),
        "USER EDITED",
        "the publish must not rename over a file that appeared after the check"
    );
    assert!(
        stray_files(dir.path()).is_empty(),
        "the refused temp file is removed: {:?}",
        stray_files(dir.path())
    );
}

#[test]
fn a_directory_that_lands_on_the_name_after_the_check_is_reported_not_renamed_over() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    let err = publish_with(&target, b"BUNDLED", |temp, to| {
        fs::create_dir(to).expect("squat");
        claim_no_clobber(temp, to)
    })
    .expect_err("a directory is not a genie");
    assert!(err.contains("not a regular file"), "got: {err}");
    assert!(target.is_dir(), "the squatter is reported, never replaced");
    assert!(
        stray_files(dir.path()).is_empty(),
        "{:?}",
        stray_files(dir.path())
    );
}

#[test]
fn a_claim_that_fails_for_another_reason_is_reported_and_leaves_no_temp_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    let err = publish_with(&target, b"BUNDLED", |temp, _| {
        Err(tempfile::PersistError {
            error: std::io::Error::from(std::io::ErrorKind::Unsupported),
            file: temp,
        })
    })
    .expect_err("an unsupported filesystem is an error, not a clobber");
    assert!(err.contains("Failed to publish"), "got: {err}");
    assert!(!target.exists(), "nothing was written to the final name");
    assert!(
        stray_files(dir.path()).is_empty(),
        "{:?}",
        stray_files(dir.path())
    );
}

#[test]
fn publish_refuses_a_directory_at_the_target() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("polish.md");
    fs::create_dir(&target).expect("mkdir");
    let err = publish_no_clobber(&target, b"BUNDLED").expect_err("a directory is not a genie");
    assert!(err.contains("not a regular file"), "got: {err}");
    assert!(target.is_dir());
    assert!(
        stray_files(dir.path()).is_empty(),
        "{:?}",
        stray_files(dir.path())
    );
}

#[test]
fn bundled_genie_paths_are_unique_relative_markdown_files_with_unique_names() {
    let mut paths = BTreeSet::new();
    for genie in DEFAULT_GENIES {
        let path = Path::new(genie.path);
        assert!(
            path.is_relative(),
            "{} must be relative to the genies dir",
            genie.path
        );
        assert!(
            !path
                .components()
                .any(|c| c == std::path::Component::ParentDir),
            "{} must not climb out of the genies dir",
            genie.path
        );
        assert_eq!(
            path.extension().and_then(|e| e.to_str()),
            Some("md"),
            "{}",
            genie.path
        );
        assert!(paths.insert(genie.path), "{} is bundled twice", genie.path);
    }
    // The scanner keys genies by file stem, so two bundled genies sharing a
    // stem would hide one of them from the picker.
    let names = default_genie_names();
    let unique: BTreeSet<&str> = names.iter().copied().collect();
    assert_eq!(
        unique.len(),
        names.len(),
        "duplicate genie names: {names:?}"
    );
}

// #348 — one stat, and only absence reaches the publish. A name that could not
// be EXAMINED is reported as that, not fallen through to a write that fails
// again one layer further from its cause.
#[cfg(unix)]
#[test]
fn a_target_that_cannot_be_examined_is_reported_rather_than_written_over() {
    // Imported here, not at module scope: this test is Unix-only, and an
    // import the Windows cross-compile cannot see a user for is a hard error
    // there (`-D warnings`).
    use super::{install_one, DefaultGenie};
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().expect("tempdir");
    let base = root.path().to_path_buf();
    let category = base.join("editing");
    std::fs::create_dir(&category).expect("mkdir");
    std::fs::set_permissions(&category, std::fs::Permissions::from_mode(0o000)).expect("chmod");

    let readable_anyway = std::fs::symlink_metadata(category.join("x.md")).is_ok()
        || std::fs::read_dir(&category).is_ok();
    let genie = DefaultGenie {
        path: "editing/probe.md",
        content: "body",
    };
    let canonical_base = std::fs::canonicalize(&base).expect("canonical");
    let outcome = install_one(&base, &canonical_base, &genie);
    std::fs::set_permissions(&category, std::fs::Permissions::from_mode(0o700)).expect("restore");
    // Root ignores the mode bits, so there is nothing to assert there.
    if readable_anyway {
        return;
    }
    let err = outcome.expect_err("an unreadable parent is not an empty name");
    assert!(err.contains("probe.md"), "{err}");
}
