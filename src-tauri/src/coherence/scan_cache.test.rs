// WI-RA11.4 — a scan does not re-read a markdown file whose metadata stamp is
// unchanged since a scan read it, and reaches exactly the conclusions a scan
// that reads everything reaches.

use super::*;
use crate::coherence::capture::{capture, CaptureRequest};
use crate::coherence::scan::{scan_workspace, ScanReport};
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, Intent, TypedBody, WriterId};
use std::path::Path;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(9))).unwrap();
    (dir, kernel)
}

fn write(root: &Path, rel: &str, content: &str) {
    let abs = root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, content).unwrap();
}

fn save(rel: &str, content: &str, rewrite_identity: bool) -> CaptureRequest {
    CaptureRequest {
        path: rel.into(),
        content: content.into(),
        inputs: vec![],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "editor-save".into(),
            summary: "save".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
        rewrite_identity,
        idem: None,
    }
}

/// Write `content` at `rel` and capture it, as an editor save does.
fn saved_doc(kernel: &mut WorkspaceKernel, root: &Path, rel: &str, content: &str) {
    write(root, rel, content);
    capture(kernel, save(rel, content, true)).unwrap();
}

fn reads(kernel: &WorkspaceKernel) -> usize {
    kernel.scan_cache.reads()
}

// ── the stamp ────────────────────────────────────────────────────────────────

fn stamp_at(modified: SystemTime) -> FileStamp {
    FileStamp {
        len: 10,
        modified,
        #[cfg(unix)]
        changed: (0, 0),
        #[cfg(unix)]
        inode: (1, 2),
    }
}

#[test]
fn a_stamp_is_settled_only_once_the_file_has_been_quiet_for_the_slack() {
    let now = SystemTime::now();
    assert!(stamp_at(now - Duration::from_secs(60)).settled_at(now, MTIME_SLACK));
    assert!(stamp_at(now - MTIME_SLACK).settled_at(now, MTIME_SLACK));
    assert!(!stamp_at(now - Duration::from_millis(1500)).settled_at(now, MTIME_SLACK));
    assert!(!stamp_at(now).settled_at(now, MTIME_SLACK));
    // A file "modified in the future" (clock skew) is never trusted.
    assert!(!stamp_at(now + Duration::from_secs(60)).settled_at(now, MTIME_SLACK));
}

#[test]
fn an_unsettled_file_is_forgotten_rather_than_remembered() {
    let mut cache = ScanCache::default();
    let now = SystemTime::now();
    let facts = FileFacts {
        identity: None,
        hash: None,
    };
    let old = stamp_at(now - Duration::from_secs(60));
    cache.remember("a.md", Some(old.clone()), now, facts.clone());
    assert!(cache.unchanged("a.md", &old).is_some());

    // Rewritten a moment ago: the old entry must not survive either.
    cache.remember("a.md", Some(stamp_at(now)), now, facts.clone());
    assert!(cache.unchanged("a.md", &old).is_none());
    assert_eq!(cache.len(), 0);

    // No stamp at all (no mtime on this platform): never remembered.
    cache.remember("b.md", None, now, facts);
    assert_eq!(cache.len(), 0);
}

#[test]
fn a_different_stamp_is_a_miss() {
    let mut cache = ScanCache::default();
    let now = SystemTime::now();
    let stamp = stamp_at(now - Duration::from_secs(60));
    let facts = FileFacts {
        identity: None,
        hash: None,
    };
    cache.remember("笔记/a.md", Some(stamp.clone()), now, facts);

    let mut longer = stamp.clone();
    longer.len += 1;
    assert!(cache.unchanged("笔记/a.md", &longer).is_none());
    let mut touched = stamp.clone();
    // One microsecond, not one nanosecond: Windows `SystemTime` counts 100 ns
    // units, so adding 1 ns rounds away and the stamps compare equal there.
    touched.modified += Duration::from_micros(1);
    assert!(cache.unchanged("笔记/a.md", &touched).is_none());
    assert!(cache.unchanged("笔记/other.md", &stamp).is_none());
    assert!(cache.unchanged("笔记/a.md", &stamp).is_some());
}

// ── scans ────────────────────────────────────────────────────────────────────

#[test]
fn an_unchanged_workspace_is_not_read_again() {
    let (dir, mut kernel) = workspace();
    kernel.scan_cache.trust_recent_stamps();
    saved_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    saved_doc(&mut kernel, dir.path(), "notes/b.md", "beta\n");
    write(dir.path(), "plain.md", "not an object\n");

    let first = scan_workspace(&mut kernel).unwrap();
    let after_first = reads(&kernel);
    let second = scan_workspace(&mut kernel).unwrap();

    assert_eq!(after_first, 3, "the first scan reads every file");
    assert_eq!(reads(&kernel), after_first, "the second scan reads none");
    assert_eq!(second, first);
    assert!(second.complete);
}

#[test]
fn a_changed_file_is_read_again_and_its_edit_recorded() {
    let (dir, mut kernel) = workspace();
    kernel.scan_cache.trust_recent_stamps();
    saved_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    saved_doc(&mut kernel, dir.path(), "b.md", "beta\n");
    scan_workspace(&mut kernel).unwrap();
    let before = reads(&kernel);

    let on_disk = std::fs::read_to_string(dir.path().join("a.md")).unwrap();
    write(
        dir.path(),
        "a.md",
        &on_disk.replace("alpha", "ALPHA, edited elsewhere"),
    );
    let report = scan_workspace(&mut kernel).unwrap();

    assert_eq!(reads(&kernel), before + 1, "only the changed file is read");
    assert_eq!(report.external_edits, 1);
}

/// A tool that rewrites a file and puts its old mtime back (`cp -p`,
/// `rsync -t`, `touch -r`) leaves size and mtime as they were. The
/// status-change time is the kernel's and cannot be put back.
#[cfg(unix)]
#[test]
fn a_same_size_rewrite_that_restores_the_mtime_is_still_seen() {
    let (dir, mut kernel) = workspace();
    kernel.scan_cache.trust_recent_stamps();
    saved_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    let path = dir.path().join("a.md");
    scan_workspace(&mut kernel).unwrap();
    let old_mtime = std::fs::metadata(&path).unwrap().modified().unwrap();

    let on_disk = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, on_disk.replace("alpha", "ALPHA")).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(old_mtime)
        .unwrap();
    let report = scan_workspace(&mut kernel).unwrap();

    assert_eq!(report.external_edits, 1);
}

/// How many files the second of two scans reads, when the scans stamp files
/// at `offset` past the moment the file last changed (before it when
/// `before`). The clock is frozen: the slack is measured against a chosen
/// moment, so no stall of the test thread can move the answer.
fn second_scan_reads(offset: Duration, before: bool) -> usize {
    let (dir, mut kernel) = workspace();
    saved_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    let meta = std::fs::metadata(dir.path().join("a.md")).unwrap();
    let changed = FileStamp::of(&meta).unwrap().last_change();
    kernel.scan_cache.freeze_now(if before {
        changed - offset
    } else {
        changed + offset
    });

    scan_workspace(&mut kernel).unwrap();
    let after_first = reads(&kernel);
    assert_eq!(after_first, 1, "the first scan reads the file");
    scan_workspace(&mut kernel).unwrap();
    reads(&kernel) - after_first
}

// A file modified within the slack may change again inside the same timestamp
// tick, so its stamp is not trusted yet: it is read on every scan.
#[test]
fn a_file_written_just_before_the_scan_is_read_every_time() {
    assert_eq!(second_scan_reads(Duration::ZERO, false), 1);
    assert_eq!(second_scan_reads(Duration::from_millis(500), false), 1);
}

/// Windows `SystemTime` counts 100 ns units, so the margin is 1 us, not 1 ns.
#[test]
fn a_file_one_tick_inside_the_slack_is_still_read_every_time() {
    assert_eq!(
        second_scan_reads(MTIME_SLACK - Duration::from_micros(1), false),
        1
    );
}

#[test]
fn a_file_quiet_for_exactly_the_slack_is_trusted() {
    assert_eq!(second_scan_reads(MTIME_SLACK, false), 0);
    assert_eq!(second_scan_reads(Duration::from_secs(3600), false), 0);
}

#[test]
fn a_file_modified_in_the_future_is_read_every_time() {
    assert_eq!(second_scan_reads(Duration::from_micros(1), true), 1);
    assert_eq!(second_scan_reads(Duration::from_secs(3600), true), 1);
}

#[test]
fn renamed_and_deleted_files_leave_the_cache() {
    let (dir, mut kernel) = workspace();
    kernel.scan_cache.trust_recent_stamps();
    saved_doc(&mut kernel, dir.path(), "old.md", "content\n");
    saved_doc(&mut kernel, dir.path(), "gone.md", "doomed\n");
    scan_workspace(&mut kernel).unwrap();
    assert_eq!(kernel.scan_cache.len(), 2);

    std::fs::rename(dir.path().join("old.md"), dir.path().join("moved.md")).unwrap();
    std::fs::remove_file(dir.path().join("gone.md")).unwrap();
    let report = scan_workspace(&mut kernel).unwrap();

    assert_eq!(kernel.scan_cache.len(), 1, "only moved.md is remembered");
    assert_eq!(report.absent_marked, 1);
    assert_eq!(report.external_edits, 0);
    let registry = kernel.index().registry_state().unwrap();
    assert!(registry.object_at.contains_key("moved.md"));
}

// ── same conclusions as a scan that reads everything ─────────────────────────

/// What a run of scans concluded: every report, and every revision content
/// the ledger recorded, in order. Object ids are minted fresh per workspace,
/// so the content hashes are what two runs can be compared on.
type Outcome = (Vec<ScanReport>, Vec<String>);

/// One scripted session: saves, external edits, live-buffer captures (which
/// move the head without touching the disk), a rename and a deletion — with
/// a scan after each step. `warm` keeps the cache between scans; otherwise it
/// is emptied before every scan, which is a scan that reads every file.
fn session(warm: bool) -> Outcome {
    let (dir, mut kernel) = workspace();
    let root = dir.path().to_path_buf();
    let mut reports = Vec::new();
    let mut scan = |kernel: &mut WorkspaceKernel| {
        if !warm {
            kernel.scan_cache = ScanCache::default();
        }
        kernel.scan_cache.trust_recent_stamps();
        reports.push(scan_workspace(kernel).unwrap());
    };

    saved_doc(&mut kernel, &root, "a.md", "alpha\n");
    saved_doc(&mut kernel, &root, "b.md", "beta\n");
    write(&root, "plain.md", "no identity\n");
    scan(&mut kernel);

    let b = std::fs::read_to_string(root.join("b.md")).unwrap();
    write(&root, "b.md", &format!("{b}appended elsewhere\n"));
    scan(&mut kernel);

    // Live-buffer captures: the disk keeps the old content. The first leaves
    // it as expected lag; the second moves the head on again, after which the
    // untouched file on disk is an external state that must be recorded —
    // from a file this scan did not otherwise need to read.
    capture(&mut kernel, save("a.md", "alpha 2\n", false)).unwrap();
    scan(&mut kernel);
    capture(&mut kernel, save("a.md", "alpha 3\n", false)).unwrap();
    scan(&mut kernel);

    std::fs::create_dir_all(root.join("notes")).unwrap();
    std::fs::rename(root.join("plain.md"), root.join("notes/plain.md")).unwrap();
    std::fs::remove_file(root.join("b.md")).unwrap();
    scan(&mut kernel);
    scan(&mut kernel);

    let hashes = kernel
        .ledger()
        .read_all()
        .unwrap()
        .entries
        .iter()
        .filter_map(|e| match e.typed().unwrap() {
            TypedBody::Transformation(t) => Some(t.outputs[0].content_hash.as_str().to_string()),
            _ => None,
        })
        .collect();
    (reports, hashes)
}

#[test]
fn a_cached_scan_concludes_exactly_what_a_full_scan_concludes() {
    let full = session(false);
    let cached = session(true);
    assert_eq!(cached.0, full.0, "the scan reports differ");
    assert_eq!(cached.1, full.1, "the recorded revisions differ");
    // The session is not vacuous: it records an external edit and the
    // externally observed state behind two live-buffer captures.
    assert_eq!(full.0[1].external_edits, 1);
    assert_eq!(full.0[3].external_edits, 1);
    assert_eq!(full.0[4].absent_marked, 1);
}
