// WI-AL4.1 — Git export end to end on a fixture journal and a real repository: round-trip (every retained revision's text and id read back from its commit; the working tree, index and HEAD untouched; a path with spaces and CJK); the collected-run fixture retained → two collected → retained exports exactly one synthetic commit with sorted VMark-Actors; re-export is idempotent, also after journal GC, and appends only new revisions; identical journals give identical commit ids; a branch advanced elsewhere is a conflict, never an overwrite; a non-empty unrelated branch is refused; missing Git and a folder that is not a repository give clear errors
use super::export::{export_document, export_with, ExportReport};
use super::git::Git;
use super::names::branch_ref;
use super::state::ExportState;
use crate::agent_journal::ids::{DocId, RevisionId};
use crate::agent_journal::review::ReviewOp;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use crate::agent_journal::writer_gc::GcPolicy;

const KEY: &str = r"path:C:\Users\me\My Notes\计划 plan.md";
const FILE: &str = "计划 plan.md";
const AUTHOR: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Someone"),
    ("GIT_AUTHOR_EMAIL", "someone@example.invalid"),
    ("GIT_COMMITTER_NAME", "Someone"),
    ("GIT_COMMITTER_EMAIL", "someone@example.invalid"),
];

/// A fresh repository under a folder whose name has spaces and CJK, with
/// one commit on its default branch so HEAD, the index and the working
/// tree have something to stay untouched.
fn repo(root: &std::path::Path, name: &str) -> Git {
    let dir = root.join(format!("{name} 仓库 with spaces"));
    std::fs::create_dir_all(&dir).expect("mkdir");
    let git = Git::new("git", dir.clone());
    git.run(&["init", "-q"], None, &[]).expect("init");
    std::fs::write(dir.join("README.md"), "hello\n").expect("write");
    git.run(&["add", "README.md"], None, &[]).expect("add");
    git.run(&["commit", "-q", "-m", "init"], None, &AUTHOR)
        .expect("commit");
    git
}

/// The export record beside the fixture journal, as the app keeps it.
fn st(journal: &tempfile::TempDir) -> ExportState {
    ExportState::in_dir(journal.path())
}

fn agent_write(w: &Writer, doc: DocId, text: &str) -> RevisionId {
    let pre = head_text(w, doc);
    let p = w
        .prepare(prepare_req(doc, w.head(doc), &pre, ReviewOp::None))
        .expect("prepare");
    let req = commit_req_op(
        w,
        doc,
        text,
        &[diff_edit(&pre, text)],
        vec![],
        &ReviewOp::None,
    );
    w.commit(p.txn, req).expect("commit").revision
}

fn tip(git: &Git, doc: DocId) -> Option<String> {
    git.run(
        &["rev-parse", "--verify", "-q", &branch_ref(doc)],
        None,
        &[],
    )
    .ok()
}

fn branch_commits(git: &Git, doc: DocId) -> Vec<String> {
    git.run(&["rev-list", "--reverse", &branch_ref(doc)], None, &[])
        .expect("rev-list")
        .lines()
        .map(str::to_owned)
        .collect()
}

fn show(git: &Git, rev: &str) -> String {
    git.run(&["show", "-s", "--format=%B", rev], None, &[])
        .expect("show")
}

fn file_at(git: &Git, commit: &str) -> String {
    // `cat-file blob` keeps the text exactly (no trailing-newline trim).
    let raw = git
        .run_raw(&["cat-file", "blob", &format!("{commit}:{FILE}")], None)
        .expect("cat-file");
    String::from_utf8(raw).expect("utf8")
}

fn untouched(git: &Git) -> (String, String, Vec<u8>) {
    let head = git.run(&["rev-parse", "HEAD"], None, &[]).expect("head");
    let status = git
        .run(
            &["status", "--porcelain", "--untracked-files=all"],
            None,
            &[],
        )
        .expect("status");
    let index = std::fs::read(git.dir().join(".git").join("index")).expect("index");
    (head, status, index)
}

fn policy(max_revisions: usize) -> GcPolicy {
    GcPolicy {
        max_revisions,
        ..GcPolicy::default()
    }
}

#[test]
fn round_trip_on_a_fixture_journal_reads_every_revision_back() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    let texts = [
        "# Plan\n",
        "# Plan\n\n中文 🎉\r\nline\n",
        "",
        "no newline at end",
    ];
    let revs = [
        human_save(&w, doc, texts[0]),
        agent_write(&w, doc, texts[1]),
        agent_write(&w, doc, texts[2]),
        human_save(&w, doc, texts[3]),
    ];
    let git = repo(root.path(), "round trip");
    let before = untouched(&git);

    let report = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("export");
    assert_eq!(report.commits_created, 4);
    assert_eq!(report.synthetic_created, 0);
    assert_eq!(report.branch, format!("vmark-journal/{doc}"));
    let commits = branch_commits(&git, doc);
    assert_eq!(Some(commits[3].clone()), report.head);
    for (i, c) in commits.iter().enumerate() {
        assert_eq!(
            file_at(&git, c),
            texts[i],
            "commit {i} holds revision {i}'s text"
        );
        let msg = show(&git, c);
        assert!(
            msg.contains(&format!("VMark-Revision: {}", revs[i])),
            "{msg}"
        );
        assert!(msg.contains(&format!("VMark-Document: {doc}")));
    }
    let author = git
        .run(
            &["log", "-1", "--format=%an|%ae|%cn", &commits[1]],
            None,
            &[],
        )
        .expect("log");
    assert_eq!(author, "mcp:claude|mcp.claude@vmark.invalid|VMark");
    assert_eq!(
        untouched(&git),
        before,
        "HEAD, index and working tree untouched"
    );
}

#[test]
fn collected_run_fixture_exports_one_synthetic_commit_and_re_export_is_idempotent() {
    // retained → two collected → retained
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    let r1 = human_save(&w, doc, "one");
    let r2 = agent_write(&w, doc, "two");
    let r3 = human_save(&w, doc, "three");
    let r4 = human_save(&w, doc, "four");
    w.register_external_root(r1);
    let report = w.collect(&policy(2)).expect("collect");
    assert_eq!(report.collected, vec![r2, r3]);
    let git = repo(root.path(), "collected");

    let first = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("export");
    assert_eq!((first.commits_created, first.synthetic_created), (3, 1));
    let commits = branch_commits(&git, doc);
    assert_eq!(commits.len(), 3);
    let synthetic = show(&git, &commits[1]);
    assert!(
        synthetic.contains(&format!("VMark-Collected: {r2}..{r3}")),
        "{synthetic}"
    );
    assert!(
        synthetic.contains("VMark-Actors: human, mcp:claude"),
        "sorted: {synthetic}"
    );
    assert_eq!(
        file_at(&git, &commits[1]),
        "three",
        "the next retained revision's before-text"
    );
    assert!(show(&git, &commits[2]).contains(&format!("VMark-Revision: {r4}")));

    let again = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("re-export");
    assert_eq!(again.commits_created, 0, "idempotent re-export");
    assert_eq!(again.head, first.head);
    assert_eq!(branch_commits(&git, doc), commits);
}

#[test]
fn re_export_after_journal_gc_appends_only_new_revisions() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    for t in ["a", "b", "c"] {
        human_save(&w, doc, t);
    }
    let git = repo(root.path(), "after gc");
    let first = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("export");
    assert_eq!(first.commits_created, 3);

    // GC of already-exported revisions changes nothing on re-export.
    w.collect(&policy(1)).expect("collect");
    let idem = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("re-export after gc");
    assert_eq!(
        (idem.commits_created, idem.head.clone()),
        (0, first.head.clone())
    );

    // New revisions, the older of them collected before it was exported.
    let r4 = human_save(&w, doc, "d");
    let r5 = agent_write(&w, doc, "e");
    w.collect(&policy(1)).expect("collect again");
    let next = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("append");
    assert_eq!((next.commits_created, next.synthetic_created), (2, 1));
    let commits = branch_commits(&git, doc);
    assert_eq!(commits.len(), 5);
    assert_eq!(
        commits[2],
        first.head.clone().expect("head"),
        "history kept, only appended"
    );
    assert!(show(&git, &commits[3]).contains(&format!("VMark-Collected: {r4}..{r4}")));
    assert!(show(&git, &commits[4]).contains(&format!("VMark-Revision: {r5}")));
    let last = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("idempotent");
    assert_eq!(last.commits_created, 0);
}

#[test]
fn identical_journals_export_identical_commit_ids() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "x");
    agent_write(&w, doc, "xy");
    let a = export_document(&w, doc, KEY, &repo(root.path(), "a"), &st(&jdir)).expect("a");
    let b = export_document(&w, doc, KEY, &repo(root.path(), "b"), &st(&jdir)).expect("b");
    assert_eq!(a.head, b.head, "commit ids are a function of the journal");
}

#[test]
fn a_branch_advanced_elsewhere_is_a_conflict_not_an_overwrite() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path(), "conflict");
    let first = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("export");
    let base = first.head.expect("head");
    // Someone commits on top of the export branch.
    let tree = git
        .run(&["rev-parse", &format!("{base}^{{tree}}")], None, &[])
        .expect("tree");
    let foreign = git
        .run(
            &["commit-tree", &tree, "-p", &base, "-m", "manual"],
            None,
            &AUTHOR,
        )
        .expect("commit-tree");
    git.run(
        &["update-ref", &branch_ref(doc), &foreign, &base],
        None,
        &[],
    )
    .expect("advance");
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st(&jdir)).expect_err("conflict");
    assert_eq!(err.code(), "EXPORT_CONFLICT");
    assert_eq!(
        tip(&git, doc).as_deref(),
        Some(foreign.as_str()),
        "not overwritten"
    );
}

#[test]
fn a_ref_moved_during_export_is_a_conflict_by_compare_and_swap() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path(), "race");
    let base = export_document(&w, doc, KEY, &git, &st(&jdir))
        .expect("export")
        .head
        .expect("head");
    human_save(&w, doc, "b");
    let main = git.run(&["rev-parse", "HEAD"], None, &[]).expect("main");
    let mut race = || {
        git.run(&["update-ref", &branch_ref(doc), &main, &base], None, &[])
            .expect("race");
    };
    let err = export_with(&w, doc, KEY, &git, &st(&jdir), &mut race).expect_err("conflict");
    assert_eq!(err.code(), "EXPORT_CONFLICT");
    assert_eq!(
        tip(&git, doc).as_deref(),
        Some(main.as_str()),
        "the other writer's ref stays"
    );
}

#[test]
fn a_concurrent_identical_export_converges_instead_of_conflicting() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path(), "rapid");
    let mut inner: Option<ExportReport> = None;
    let mut twin = || inner = Some(export_document(&w, doc, KEY, &git, &st(&jdir)).expect("twin"));
    let outer = export_with(&w, doc, KEY, &git, &st(&jdir), &mut twin).expect("converges");
    assert_eq!(outer.head, inner.expect("ran").head);
    assert_eq!(branch_commits(&git, doc).len(), 1);
}

#[test]
fn export_into_a_non_empty_unrelated_branch_is_refused() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path(), "unrelated");
    let main = git.run(&["rev-parse", "HEAD"], None, &[]).expect("main");
    git.run(&["update-ref", &branch_ref(doc), &main, ""], None, &[])
        .expect("branch");
    let err = export_document(&w, doc, KEY, &git, &st(&jdir)).expect_err("unrelated");
    assert_eq!(err.code(), "UNRELATED_BRANCH");
    assert_eq!(tip(&git, doc).as_deref(), Some(main.as_str()));
}

#[test]
fn an_empty_document_exports_nothing_and_creates_no_branch() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    let git = repo(root.path(), "empty");
    let report = export_document(&w, doc, KEY, &git, &st(&jdir)).expect("export");
    assert_eq!((report.commits_created, report.head), (0, None));
    assert_eq!(tip(&git, doc), None);
}

#[test]
fn missing_git_is_a_clear_message() {
    let root = tmp();
    let err = Git::open_with(
        "vmark-no-such-git-binary",
        None,
        &root.path().to_string_lossy(),
    )
    .expect_err("git not found");
    assert_eq!(err.code(), "GIT_MISSING");
    assert!(err.to_string().contains("Git is not installed"), "{err}");
}

#[test]
fn a_folder_that_is_not_a_repository_or_not_absolute_is_refused() {
    let root = tmp();
    let plain = root.path().join("plain folder");
    std::fs::create_dir_all(&plain).expect("mkdir");
    let err = Git::open(&plain.to_string_lossy()).expect_err("not a repo");
    assert_eq!(err.code(), "NOT_A_REPOSITORY");
    let err = Git::open(&root.path().join("missing").to_string_lossy()).expect_err("missing");
    assert_eq!(err.code(), "NOT_A_REPOSITORY");
    assert_eq!(
        Git::open("relative/repo").expect_err("relative").code(),
        "INVALID_REQUEST"
    );
    assert_eq!(
        Git::open(r"..\repo")
            .expect_err("relative backslash")
            .code(),
        "INVALID_REQUEST"
    );
}

#[test]
fn a_subfolder_of_a_repository_exports_into_that_repository() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path(), "sub");
    let sub = git.dir().join("docs dir");
    std::fs::create_dir_all(&sub).expect("mkdir");
    let in_sub = Git::open(&sub.to_string_lossy()).expect("open subfolder");
    export_document(&w, doc, KEY, &in_sub, &st(&jdir)).expect("export");
    assert!(tip(&git, doc).is_some());
}
