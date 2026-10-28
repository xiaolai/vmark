// WI-AL4.1 — Git export guards: a tip rewritten with copied trailers or rewound is a conflict by the durable record, a crash between the ref swap and the record still recognises VMark's own commit, a symbolic export ref and a branch checked out in a worktree are refused, replace objects cannot disguise the branch, inherited GIT_* variables are removed, a corrupt record fails loud, and a renamed document keeps the file name the branch already holds
use super::export::export_document;
use super::git::{inherited_git_vars, Git};
use super::names::branch_ref;
use super::state::{Expected, ExportState, STATE_FILE};
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
    let dir = root.join("guard repo");
    std::fs::create_dir_all(&dir).expect("mkdir");
    let git = Git::new("git", dir.clone());
    git.run(&["init", "-q"], None, &[]).expect("init");
    std::fs::write(dir.join("README.md"), "hello\n").expect("write");
    git.run(&["add", "README.md"], None, &[]).expect("add");
    git.run(&["commit", "-q", "-m", "init"], None, &AUTHOR)
        .expect("commit");
    git
}

fn tip(git: &Git, doc: DocId) -> Option<String> {
    git.run(
        &["rev-parse", "--verify", "-q", &branch_ref(doc)],
        None,
        &[],
    )
    .ok()
}

fn set_ref(git: &Git, doc: DocId, to: &str) {
    git.run(&["update-ref", &branch_ref(doc), to], None, &[])
        .expect("update-ref");
}

#[test]
fn a_tip_rewritten_with_the_same_trailers_is_a_conflict() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let first = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head
        .expect("head");
    // Same message (trailers and all), different file content.
    let msg = git
        .run(&["show", "-s", "--format=%B", &first], None, &[])
        .expect("msg");
    let blob = git
        .run(&["hash-object", "-w", "--stdin"], Some(b"tampered"), &[])
        .expect("blob");
    let tree = git
        .run(
            &["mktree"],
            Some(format!("100644 blob {blob}\tplan.md\n").as_bytes()),
            &[],
        )
        .expect("tree");
    let forged = git
        .run(
            &["commit-tree", &tree, "-F", "-"],
            Some(msg.as_bytes()),
            &AUTHOR,
        )
        .expect("commit");
    set_ref(&git, doc, &forged);
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("rewritten");
    assert_eq!(err.code(), "EXPORT_CONFLICT");
    assert_eq!(tip(&git, doc).as_deref(), Some(forged.as_str()));
}

#[test]
fn a_rewound_branch_is_a_conflict() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    human_save(&w, doc, "b");
    let git = repo(root.path());
    let head = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head
        .expect("head");
    let older = git
        .run(&["rev-parse", &format!("{head}~1")], None, &[])
        .expect("parent");
    set_ref(&git, doc, &older);
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("rewound");
    assert_eq!(err.code(), "EXPORT_CONFLICT");
    assert_eq!(tip(&git, doc).as_deref(), Some(older.as_str()));
}

#[test]
fn a_crash_after_the_swap_still_recognises_the_pending_commit() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let x = export_document(&w, doc, KEY, &git, &st)
        .expect("a")
        .head
        .expect("x");
    human_save(&w, doc, "b");
    let y = export_document(&w, doc, KEY, &git, &st)
        .expect("b")
        .head
        .expect("y");
    let repository = git.common_dir().expect("common dir");
    // The record as a crash between update-ref and the confirmation leaves it.
    st.store(
        doc,
        &repository,
        Expected {
            commit: x,
            pending: Some(y.clone()),
        },
    )
    .expect("store");
    let again = export_document(&w, doc, KEY, &git, &st).expect("recognised");
    assert_eq!(
        (again.commits_created, again.head.as_deref()),
        (0, Some(y.as_str()))
    );
    let confirmed = st.expected(doc, &repository).expect("read").expect("entry");
    assert_eq!(
        confirmed,
        Expected {
            commit: y,
            pending: None
        }
    );
}

#[test]
fn a_symbolic_export_ref_is_refused_and_its_target_untouched() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let exported = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head
        .expect("head");
    // The export branch becomes a symbolic ref to a copy of itself, so its
    // resolved tip is exactly the commit VMark recorded.
    git.run(
        &["update-ref", "refs/heads/elsewhere", &exported],
        None,
        &[],
    )
    .expect("copy");
    git.run(&["update-ref", "-d", &branch_ref(doc)], None, &[])
        .expect("delete");
    git.run(
        &["symbolic-ref", &branch_ref(doc), "refs/heads/elsewhere"],
        None,
        &[],
    )
    .expect("symref");
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("symref");
    assert_eq!(err.code(), "UNRELATED_BRANCH");
    let target = git
        .run(&["rev-parse", "refs/heads/elsewhere"], None, &[])
        .expect("target");
    assert_eq!(target, exported, "the symbolic ref's target is not moved");
}

#[test]
fn a_branch_checked_out_in_a_worktree_is_refused() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let head = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head;
    let wt = root.path().join("linked worktree");
    git.run(
        &[
            "worktree",
            "add",
            "-q",
            &wt.to_string_lossy(),
            &format!("vmark-journal/{doc}"),
        ],
        None,
        &[],
    )
    .expect("worktree add");
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("checked out");
    assert_eq!(err.code(), "BRANCH_CHECKED_OUT");
    assert_eq!(tip(&git, doc), head);
}

#[test]
fn replace_objects_cannot_disguise_the_export_branch() {
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
    let main = git.run(&["rev-parse", "HEAD"], None, &[]).expect("main");
    git.run(&["replace", &head, &main], None, &[])
        .expect("replace");
    human_save(&w, doc, "b");
    let next = export_document(&w, doc, KEY, &git, &st).expect("reads the real objects");
    assert_eq!(next.commits_created, 1);
}

#[test]
fn inherited_git_variables_are_all_removed() {
    let names = [
        "GIT_DIR",
        "GIT_INDEX_FILE",
        "GIT_CONFIG_COUNT",
        "GIT_COMMON_DIR",
        "PATH",
        "HOME",
        "MY_GIT_X",
        // Windows names are case-insensitive: Git reads these as GIT_DIR.
        "Git_Dir",
        "git_config_global",
    ];
    let removed = inherited_git_vars(names.iter().map(std::ffi::OsString::from));
    let removed: Vec<_> = removed
        .iter()
        .map(|k| k.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        removed,
        vec![
            "GIT_DIR",
            "GIT_INDEX_FILE",
            "GIT_CONFIG_COUNT",
            "GIT_COMMON_DIR",
            "Git_Dir",
            "git_config_global"
        ]
    );
}

#[test]
fn a_corrupt_export_record_fails_loud_and_moves_nothing() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    let head = export_document(&w, doc, KEY, &git, &st)
        .expect("export")
        .head;
    std::fs::write(jdir.path().join(STATE_FILE), b"{not json").expect("corrupt");
    human_save(&w, doc, "b");
    let err = export_document(&w, doc, KEY, &git, &st).expect_err("corrupt");
    assert_eq!(err.code(), "JOURNAL_ERROR");
    assert_eq!(tip(&git, doc), head);
}

#[test]
fn a_renamed_document_keeps_the_file_name_the_branch_holds() {
    let (jdir, root) = (tmp(), tmp());
    let (w, _) = open(jdir.path());
    let st = ExportState::in_dir(jdir.path());
    let doc = DocId::new();
    human_save(&w, doc, "a");
    let git = repo(root.path());
    export_document(&w, doc, KEY, &git, &st).expect("export");
    human_save(&w, doc, "b");
    let head = export_document(&w, doc, r"path:D:\moved\renamed.md", &git, &st)
        .expect("export")
        .head
        .expect("head");
    let names = git
        .run(&["ls-tree", "--name-only", &head], None, &[])
        .expect("ls-tree");
    assert_eq!(names, "plan.md");
}
