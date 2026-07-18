// WI-1.7 — git reconciliation (spec §5.4.2, R18, Gate G2): the pure
// classifier ports the G2 probe matrix (MERGE_HEAD checked first,
// mutation = HEAD among newly minted shas, navigation = HEAD among
// previously known shas, raw-ref comparison splits no-op), plus real
// temp-repo integration tests for `observe`.

use super::*;
use std::collections::HashSet;

fn obs(head_ref: &str, head_sha: &str, shas: &[&str], merging: bool) -> GitObservation {
    GitObservation {
        head_ref: head_ref.to_string(),
        head_sha: Some(head_sha.to_string()),
        known_shas: shas.iter().map(|s| s.to_string()).collect::<HashSet<_>>(),
        merge_in_progress: merging,
    }
}

#[test]
fn not_git_and_appearing_repos() {
    assert_eq!(classify(None, None), GitClass::NotGit);
    let a = obs("main", "s1", &["s1"], false);
    assert!(matches!(
        classify(None, Some(&a)),
        GitClass::ExternalUnknown
    ));
    assert!(matches!(
        classify(Some(&a), None),
        GitClass::ExternalUnknown
    ));
}

#[test]
fn merge_in_progress_wins_over_everything() {
    // G2 surprise: mid-conflict merges are invisible to sha/reflog
    // observables — MERGE_HEAD must be checked FIRST.
    let b = obs("main", "s1", &["s1"], false);
    let a = obs("main", "s1", &["s1", "s2"], true);
    assert_eq!(classify(Some(&b), Some(&a)), GitClass::MergeInProgress);
}

#[test]
fn new_head_sha_is_mutation() {
    // revert / merge commit: HEAD lands on a newly minted sha.
    let b = obs("main", "s1", &["s1"], false);
    let a = obs("main", "s2", &["s1", "s2"], false);
    match classify(Some(&b), Some(&a)) {
        GitClass::Mutation { new_shas } => assert_eq!(new_shas, vec!["s2".to_string()]),
        other => panic!("expected mutation, got {other:?}"),
    }
}

#[test]
fn head_on_previously_known_sha_is_navigation() {
    // checkout of an older commit / branch switch / reset --hard.
    let b = obs("main", "s2", &["s1", "s2"], false);
    let a = obs("HEAD", "s1", &["s1", "s2"], false);
    match classify(Some(&b), Some(&a)) {
        GitClass::Navigation { op: _, from, to } => {
            assert_eq!(from, "s2");
            assert_eq!(to, "s1");
        }
        other => panic!("expected navigation, got {other:?}"),
    }
}

#[test]
fn fast_forward_merge_is_navigation() {
    // FF merge: zero new shas, HEAD moves to a sha that already existed
    // on the other branch (G2 recommended handling).
    let b = obs("main", "s1", &["s1", "s9"], false);
    let a = obs("main", "s9", &["s1", "s9"], false);
    assert!(matches!(
        classify(Some(&b), Some(&a)),
        GitClass::Navigation { .. }
    ));
}

#[test]
fn branch_switch_to_same_sha_is_navigation_not_noop() {
    // Same sha, different ref: the working tree may be identical but the
    // context changed — record the navigation.
    let b = obs("main", "s1", &["s1"], false);
    let a = obs("feature", "s1", &["s1"], false);
    assert!(matches!(
        classify(Some(&b), Some(&a)),
        GitClass::Navigation { .. }
    ));
}

#[test]
fn identical_observation_is_noop() {
    let b = obs("main", "s1", &["s1"], false);
    let a = obs("main", "s1", &["s1"], false);
    assert_eq!(classify(Some(&b), Some(&a)), GitClass::NoOp);
}

#[test]
fn reset_hard_shrinking_sha_set_is_still_navigation() {
    // G2 surprise: `reset --hard` SHRINKS rev-list --all — never assume
    // monotonic growth.
    let b = obs("main", "s2", &["s1", "s2"], false);
    let a = obs("main", "s1", &["s1"], false);
    assert!(matches!(
        classify(Some(&b), Some(&a)),
        GitClass::Navigation { .. }
    ));
}

#[test]
fn fetch_only_new_shas_without_head_move_is_noop() {
    let b = obs("main", "s1", &["s1"], false);
    let a = obs("main", "s1", &["s1", "remote1"], false);
    assert_eq!(classify(Some(&b), Some(&a)), GitClass::NoOp);
}

#[test]
fn unknown_head_is_external_unknown() {
    let b = obs("main", "s1", &["s1"], false);
    let mut a = obs("main", "s1", &["s1"], false);
    a.head_sha = None;
    assert!(matches!(
        classify(Some(&b), Some(&a)),
        GitClass::ExternalUnknown
    ));
}

// ── integration: real repos in temp dirs ────────────────────────────────

fn run_git(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn observe_returns_none_outside_git() {
    let dir = tempfile::tempdir().unwrap();
    assert!(observe(dir.path()).is_none());
}

#[test]
fn observe_and_classify_checkout_and_revert_in_real_repo() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("a.md"), "one\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    std::fs::write(root.join("a.md"), "two\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2"]);

    let before = observe(root).expect("git repo observed");
    assert!(before.head_sha.is_some());
    assert_eq!(before.known_shas.len(), 2);

    // Navigation: checkout the older commit (detached HEAD).
    run_git(root, &["checkout", "-q", "HEAD~1"]);
    let after_nav = observe(root).unwrap();
    assert!(matches!(
        classify(Some(&before), Some(&after_nav)),
        GitClass::Navigation { .. }
    ));

    // Mutation: back to main, then revert the last commit.
    run_git(root, &["checkout", "-q", "main"]);
    let before_revert = observe(root).unwrap();
    run_git(root, &["revert", "--no-edit", "HEAD"]);
    let after_revert = observe(root).unwrap();
    assert!(matches!(
        classify(Some(&before_revert), Some(&after_revert)),
        GitClass::Mutation { .. }
    ));
}
