//! WI-FL5.3 — `read_genie`'s path-traversal guard and its parse dispatch.
//!
//! The command needs an `AppHandle` only to resolve the genies directory;
//! `read_genie_in` is the same guard and dispatch against an explicit
//! directory, so every refusal can be exercised on a temp tree. The YAML
//! branch (`parse_workflow_genie`, WI-7.1) had no test at all.

use super::{parse_workflow_genie, read_genie_in, MAX_GENIE_BYTES};
use crate::command_error::{CommandError, ErrorCode};
use crate::genies::types::GenieIoSpec;
use std::fs;
use std::path::{Path, PathBuf};

const MARKDOWN_GENIE: &str = "---\ndescription: Improve clarity and flow\nscope: selection\n\
category: editing\n---\n\nImprove the following text:\n\n{{content}}\n";

const WORKFLOW_GENIE: &str = "name: Outline and polish\ndescription: Two steps\nsteps: []\n";

/// A temp root holding `genies/editing/polish.md` plus a sibling
/// `outside.md` that no request may ever read.
struct Tree {
    root: tempfile::TempDir,
    genies: PathBuf,
    outside: PathBuf,
}

fn tree() -> Tree {
    let root = tempfile::tempdir().expect("tempdir");
    let genies = root.path().join("genies");
    fs::create_dir_all(genies.join("editing")).expect("mkdir genies/editing");
    fs::write(genies.join("editing").join("polish.md"), MARKDOWN_GENIE).expect("write genie");
    let outside = root.path().join("outside.md");
    fs::write(&outside, "---\ndescription: TOP-SECRET\n---\nleaked body\n").expect("write outside");
    Tree {
        root,
        genies,
        outside,
    }
}

fn utf8(path: &Path) -> &str {
    path.to_str().expect("utf-8 temp path")
}

/// The traversal refusal: `permission-denied`, carrying the localized key —
/// the frontend branches on the code, never on prose (#147).
fn assert_blocked(err: &CommandError) {
    assert_eq!(err.code(), ErrorCode::PermissionDenied);
    assert_eq!(err.i18n_key(), Some("errors.genie.pathBlocked"));
}

// ── traversal refusal ───────────────────────────────────────────────────────

#[test]
fn a_path_outside_the_genies_dir_is_refused_with_path_blocked() {
    let t = tree();
    let err = read_genie_in(&t.genies, utf8(&t.outside)).expect_err("outside must be refused");
    assert_blocked(&err);
    assert!(
        !err.message().contains("TOP-SECRET") && !err.message().contains("leaked"),
        "the refusal must not echo the file it refused: {}",
        err.message()
    );
}

#[test]
fn dot_dot_traversal_out_of_the_genies_dir_is_refused() {
    let t = tree();
    let sneaky = t
        .genies
        .join("editing")
        .join("..")
        .join("..")
        .join("outside.md");
    let err = read_genie_in(&t.genies, utf8(&sneaky)).expect_err("`..` must be refused");
    assert_blocked(&err);
}

#[cfg(unix)]
#[test]
fn a_symlink_inside_the_genies_dir_that_escapes_is_refused() {
    let t = tree();
    let alias = t.genies.join("alias.md");
    std::os::unix::fs::symlink(&t.outside, &alias).expect("symlink");
    let err = read_genie_in(&t.genies, utf8(&alias)).expect_err("escaping symlink must be refused");
    assert_blocked(&err);
}

#[test]
fn a_missing_file_is_an_invalid_path_not_a_blocked_one() {
    let t = tree();
    let missing = t.genies.join("nope.md");
    let err = read_genie_in(&t.genies, utf8(&missing)).expect_err("missing file");
    assert_eq!(
        err.code(),
        ErrorCode::NotFound,
        "a missing file is not a traversal"
    );
    assert!(
        err.message().contains("Invalid genie path"),
        "got: {}",
        err.message()
    );
}

#[test]
fn a_missing_genies_dir_is_reported_as_inaccessible() {
    let t = tree();
    let no_dir = t.root.path().join("no-such-dir");
    let err = read_genie_in(&no_dir, utf8(&t.outside)).expect_err("no genies dir");
    assert_eq!(err.code(), ErrorCode::Internal);
    assert!(
        err.message()
            .contains("Genies directory does not exist or is inaccessible"),
        "got: {}",
        err.message()
    );
}

// ── happy path and the parse dispatch ───────────────────────────────────────

#[test]
fn a_markdown_genie_inside_the_dir_parses_from_its_frontmatter() {
    let t = tree();
    let path = t.genies.join("editing").join("polish.md");
    let genie = read_genie_in(&t.genies, utf8(&path)).expect("inside the dir");
    assert_eq!(genie.metadata.name, "polish");
    assert_eq!(genie.metadata.description, "Improve clarity and flow");
    assert_eq!(genie.metadata.scope, "selection");
    assert_eq!(genie.metadata.category.as_deref(), Some("editing"));
    assert_eq!(genie.metadata.version, None);
    assert!(genie.template.contains("{{content}}"));
}

#[test]
fn yml_and_yaml_extensions_take_the_workflow_branch_case_insensitively() {
    let t = tree();
    for name in ["flow.yml", "FLOW2.YAML"] {
        let path = t.genies.join(name);
        fs::write(&path, WORKFLOW_GENIE).expect("write workflow genie");
        let genie = read_genie_in(&t.genies, utf8(&path)).expect(name);
        assert_eq!(
            genie.metadata.version.as_deref(),
            Some("workflow"),
            "{name}"
        );
        assert_eq!(
            genie.template, WORKFLOW_GENIE,
            "{name}: raw YAML travels whole"
        );
    }
}

#[test]
fn a_workflow_genie_is_named_by_its_file_stem_not_its_yaml_name() {
    let genie =
        parse_workflow_genie(WORKFLOW_GENIE, "/x/y/outline-and-polish.yml").expect("parses");
    assert_eq!(genie.metadata.name, "outline-and-polish");
    assert_eq!(genie.metadata.description, "Two steps");
}

#[test]
fn a_workflow_genie_falls_back_to_its_yaml_name_when_description_is_absent() {
    let genie = parse_workflow_genie("name: Outline and polish\nsteps: []\n", "outline.yml")
        .expect("parses");
    assert_eq!(genie.metadata.description, "Outline and polish");
}

// ── #151: blank is absent ───────────────────────────────────────────────────

#[test]
fn a_whitespace_only_description_falls_back_to_the_yaml_name() {
    // A present-but-blank `description:` used to win over `name:` and render
    // an empty picker line.
    let genie = parse_workflow_genie(
        "name: Outline and polish\ndescription: \"   \"\nsteps: []\n",
        "outline.yml",
    )
    .expect("parses");
    assert_eq!(genie.metadata.description, "Outline and polish");
}

#[test]
fn a_padded_description_is_stored_trimmed() {
    let genie = parse_workflow_genie("description: \"  Two steps  \"\nsteps: []\n", "flow.yml")
        .expect("parses");
    assert_eq!(genie.metadata.description, "Two steps");
}

#[test]
fn a_blank_description_and_a_blank_name_yield_an_empty_description() {
    let genie = parse_workflow_genie("name: \" \"\ndescription: \"\"\nsteps: []\n", "flow.yml")
        .expect("parses");
    assert_eq!(genie.metadata.description, "");
}

#[test]
fn a_workflow_genie_carries_document_scope_and_the_workflow_markers() {
    let genie = parse_workflow_genie(WORKFLOW_GENIE, "flow.yml").expect("parses");
    assert_eq!(genie.metadata.scope, "document");
    assert_eq!(genie.metadata.version.as_deref(), Some("workflow"));
    assert_eq!(
        genie.metadata.input,
        Some(GenieIoSpec {
            io_type: "workflow".to_string(),
            accept: None,
            description: None,
            schema: None,
        })
    );
    assert_eq!(genie.metadata.output, None);
    assert_eq!(genie.metadata.category, None);
    assert_eq!(genie.metadata.model, None);
    assert_eq!(genie.metadata.approval, None);
    assert_eq!(genie.metadata.tags, None);
}

#[test]
fn unparseable_yaml_in_a_workflow_genie_is_an_error_naming_the_file() {
    let err = parse_workflow_genie("name: [unclosed\n", "bad.yml").expect_err("invalid YAML");
    assert!(err.contains("Failed to parse YAML genie"), "got: {err}");
    assert!(err.contains("bad.yml"), "got: {err}");
}

// #346 — valid YAML is not a workflow. A sequence, or a mapping with no
// `steps:` list, can only ever appear in the picker and then fail the moment
// it runs, because `RawWorkflow` requires that list. It is refused where the
// reason can be stated.
#[test]
fn a_yaml_document_that_is_not_a_workflow_is_refused_rather_than_listed() {
    for (yaml, what) in [
        ("- a\n- b\n", "a sequence"),
        ("just a scalar\n", "a scalar"),
        ("name: No steps here\n", "a mapping with no steps"),
        ("name: x\nsteps: nope\n", "steps that is not a list"),
    ] {
        let err = parse_workflow_genie(yaml, "list.yml").expect_err(what);
        assert!(err.contains("is not a workflow"), "{what}: {err}");
    }
}

// The other direction: an empty step list is a workflow, just a trivial one.
#[test]
fn a_mapping_with_an_empty_steps_list_is_still_a_workflow() {
    let genie = parse_workflow_genie("name: Nothing\nsteps: []\n", "nothing.yml")
        .expect("an empty pipeline is well-formed");
    assert_eq!(genie.metadata.name, "nothing");
}

// #345 — the read and the picker's listing agree on what a genie is. A `.txt`
// in the genies directory used to be parsed as markdown and served.
#[test]
fn a_file_that_is_not_a_genie_extension_is_refused_rather_than_read_as_markdown() {
    let t = tree();
    let stray = t.genies.join("notes.txt");
    fs::write(&stray, "---\nname: Sneaky\n---\nbody").expect("write");
    let err = read_genie_in(&t.genies, utf8(&stray)).expect_err("not a genie");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("is not a genie"),
        "{}",
        err.message()
    );
}

// ── #148 / #149: the size cap and the format of the canonical target ────────

#[test]
fn a_genie_over_the_size_cap_is_refused_without_being_read() {
    let t = tree();
    let big = t.genies.join("big.md");
    let file = fs::File::create(&big).expect("create");
    // Sparse: `metadata().len()` is what the cap reads, so the fixture is free.
    file.set_len(MAX_GENIE_BYTES + 1).expect("set_len");
    let err = read_genie_in(&t.genies, utf8(&big)).expect_err("over the cap");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("too large"),
        "got: {}",
        err.message()
    );
}

#[test]
fn a_directory_inside_the_genies_dir_is_not_a_genie() {
    let t = tree();
    let err = read_genie_in(&t.genies, utf8(&t.genies.join("editing"))).expect_err("a directory");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("not a file"),
        "got: {}",
        err.message()
    );
}

#[test]
fn an_unparseable_genie_is_invalid_input() {
    let t = tree();
    let bad = t.genies.join("bad.yml");
    fs::write(&bad, "name: [unclosed\n").expect("write");
    let err = read_genie_in(&t.genies, utf8(&bad)).expect_err("bad YAML");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("Failed to parse YAML genie"),
        "got: {}",
        err.message()
    );
}

#[cfg(unix)]
#[test]
fn the_parser_follows_the_canonical_targets_extension_not_the_links() {
    // `flow.yml -> editing/polish.md`, inside the tree. The bytes are a
    // markdown genie; dispatching on the LINK's suffix parsed them as a
    // workflow and produced a genie the runner cannot run.
    let t = tree();
    let alias = t.genies.join("flow.yml");
    std::os::unix::fs::symlink(t.genies.join("editing").join("polish.md"), &alias)
        .expect("symlink");
    let genie = read_genie_in(&t.genies, utf8(&alias)).expect("inside the tree");
    assert_eq!(
        genie.metadata.version, None,
        "parsed as markdown, not as a workflow"
    );
    assert_eq!(genie.metadata.description, "Improve clarity and flow");
    assert_eq!(
        genie.metadata.name, "flow",
        "the requested path still names the genie"
    );
}

// ── #148: the read is checked on the open handle, not on a path ─────────────

#[cfg(unix)]
#[test]
fn a_fifo_inside_the_genies_dir_is_refused_without_blocking() {
    // The type used to be read from the path's metadata and the file opened
    // again afterwards; a file swapped for a pipe between the two blocked the
    // read until a writer appeared. The type is now read from the open
    // handle, and the open itself does not wait.
    let t = tree();
    let fifo = t.genies.join("pipe.md");
    let c_path = std::ffi::CString::new(fifo.to_str().unwrap()).expect("cstring");
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0, "mkfifo");
    let (tx, rx) = std::sync::mpsc::channel();
    let genies = t.genies.clone();
    std::thread::spawn(move || {
        let _ = tx.send(read_genie_in(&genies, fifo.to_str().unwrap()).map(|_| ()));
    });
    let outcome = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("must not block on the FIFO");
    let err = outcome.expect_err("a FIFO is not a genie");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("not a file"),
        "got: {}",
        err.message()
    );
}

#[test]
fn a_genie_that_is_not_utf8_is_invalid_input() {
    let t = tree();
    let bad = t.genies.join("binary.md");
    fs::write(&bad, [0xffu8, 0xfe, 0xfd]).expect("write");
    let err = read_genie_in(&t.genies, utf8(&bad)).expect_err("not UTF-8");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        err.message().contains("not UTF-8"),
        "got: {}",
        err.message()
    );
}
