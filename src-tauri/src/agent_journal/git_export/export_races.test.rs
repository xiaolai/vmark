// WI-AL4.1 — Git export refusals Git's own listings can hide: a dangling symbolic export ref (absent from for-each-ref) is refused, a branch checked out while the export runs is refused before the ref moves, and a shallow repository is never adopted from trailers alone because its parent lists are truncated
use super::export::{export_document, export_with};
use super::git::Git;
use super::names::branch_ref;
use super::state::{ExportState, STATE_FILE};
use crate::agent_journal::ids::DocId;
use crate::agent_journal::test_support::*;

const KEY: &str = "path:/Users/me/notes/plan.md";
const AUTHOR: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Someone"),
    ("GIT_AUTHOR_EMAIL", "someone@example.invalid"),
    ("GIT_COMMITTER_NAME", "Someone"),
    ("GIT_COMMITTER_EMAIL", "someone@example.invalid"),
];

fn repo(root: &std::path::Path) -> Git {
    let dir = root.join("race repo");
    std::fs::create_dir_all(&dir).expect("mkdir");
    let git = Git::new("git", dir.clone());
    git.run(&["init", "-q"], None, &[]).expect("init");
    std::fs::write(dir.join("README.md"), "hello\n").expect("write");
    git.run(&["add", "README.md"], None, &[]).expect("add");
    git.run(&["commit", "-q", "-m", "init"], None, &AUTHOR)
        .expect("commit");
    git
}

#[test]
fn a_dangling_symbolic_export_ref_is_refused_not_taken_for_absent() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    git.run(
        &["symbolic-ref", &branch_ref(doc), "refs/heads/missing"],
        None,
        &[],
    )
    .expect("symref");
    let err = export_document(&w, doc, KEY, &git, &ExportState::in_dir(jdir.path()))
        .expect_err("dangling");
    assert_eq!(err.code(), "UNRELATED_BRANCH");
    let target = git
        .run(&["symbolic-ref", &branch_ref(doc)], None, &[])
        .expect("still symbolic");
    assert_eq!(target, "refs/heads/missing");
    assert!(git
        .run(
            &["rev-parse", "--verify", "-q", "refs/heads/missing"],
            None,
            &[]
        )
        .is_err());
}

#[test]
fn a_branch_checked_out_during_the_export_is_refused_before_the_swap() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let head = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head;
    human_save(&w, doc, "b");
    let wt = root.path().join("late worktree");
    let mut checkout = || {
        let branch = format!("vmark-journal/{doc}");
        git.run(
            &["worktree", "add", "-q", &wt.to_string_lossy(), &branch],
            None,
            &[],
        )
        .expect("worktree add");
    };
    let err = export_with(&w, doc, KEY, &git, &st, &mut checkout).expect_err("checked out");
    assert_eq!(err.code(), "BRANCH_CHECKED_OUT");
    let tip = git.run(&["rev-parse", &branch_ref(doc)], None, &[]).ok();
    assert_eq!(tip, head, "the checked-out branch did not move");
}

#[test]
fn a_shallow_repository_is_not_adopted_from_trailers() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let head = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head
        .expect("head");
    // Without the record the branch can only be judged by its history,
    // which a shallow boundary truncates.
    std::fs::remove_file(jdir.path().join(STATE_FILE)).expect("forget the record");
    let main = git.run(&["rev-parse", "HEAD"], None, &[]).expect("main");
    std::fs::write(git.dir().join(".git").join("shallow"), format!("{main}\n")).expect("shallow");
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("shallow");
    assert_eq!(err.code(), "UNRELATED_BRANCH");
    let tip = git
        .run(&["rev-parse", &branch_ref(doc)], None, &[])
        .expect("tip");
    assert_eq!(tip, head);
}

#[test]
fn a_shallow_repository_still_accepts_the_tip_vmark_recorded() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    export_document(&w, doc, KEY, &git, &st).expect("export");
    let main = git.run(&["rev-parse", "HEAD"], None, &[]).expect("main");
    std::fs::write(git.dir().join(".git").join("shallow"), format!("{main}\n")).expect("shallow");
    human_save(&w, doc, "b");
    let next = export_document(&w, doc, KEY, &git, &st).expect("recorded tip is proof enough");
    assert_eq!(next.commits_created, 1);
}
