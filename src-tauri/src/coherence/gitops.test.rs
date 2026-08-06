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
fn first_scan_already_mid_merge_defers() {
    // Audit C5: a workspace whose very FIRST observation is mid-merge has
    // no `before` — the merge-in-progress check must still fire, not fall
    // through to ExternalUnknown.
    let a = obs("main", "s1", &["s1"], true);
    assert_eq!(classify(None, Some(&a)), GitClass::MergeInProgress);
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

// `unknown_head_is_external_unknown` used to assert that an unreadable HEAD
// falls back to ExternalUnknown. That was the defect, not the contract: the
// fallback MINTS an external-edit revision, which is itself a guess about what
// the user did. Superseded by
// `unreadable_head_after_a_known_one_is_unreliable_not_external` (defer) and
// `unborn_head_is_still_external_unknown` (genuinely no HEAD — unchanged).

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

#[test]
fn observe_includes_unreachable_detached_head_sha() {
    // Audit C7: a commit reachable ONLY through a detached HEAD (no branch
    // points at it) is absent from `rev-list --all`; it must still land in
    // `known_shas`, else re-observing it looks like an external edit.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("a.md"), "one\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    // Detach, then commit c2 while detached — no ref points at c2.
    run_git(root, &["checkout", "-q", "--detach"]);
    std::fs::write(root.join("a.md"), "two\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2-detached"]);

    let o = observe(root).expect("observed");
    let head = o.head_sha.clone().expect("detached head sha");
    assert!(
        o.known_shas.contains(&head),
        "unreachable detached HEAD {head} must be in known_shas"
    );
}

/// A repository whose HEAD suddenly reads as absent has NOT lost its commits —
/// `git rev-parse HEAD` failed. Under a loaded full-suite run a git subprocess
/// can fail transiently, and treating that as a real observation reclassified a
/// git mutation as an external edit, minting a spurious revision (#1207).
#[test]
fn unreadable_head_after_a_known_one_is_unreliable_not_external() {
    let before = obs("main", "aaa", &["aaa"], false);
    let after = GitObservation {
        head_ref: "main".to_string(),
        head_sha: None, // rev-parse failed — commits cannot vanish
        known_shas: HashSet::new(),
        merge_in_progress: false,
    };
    assert_eq!(
        classify(Some(&before), Some(&after)),
        GitClass::ObservationUnreliable
    );
}

/// An UNBORN repository legitimately has no HEAD, and never had one. That is a
/// real state, not a failed read, so it must keep its existing handling.
#[test]
fn unborn_head_is_still_external_unknown() {
    let before = GitObservation {
        head_ref: "main".to_string(),
        head_sha: None,
        known_shas: HashSet::new(),
        merge_in_progress: false,
    };
    let after = GitObservation {
        head_ref: "main".to_string(),
        head_sha: None,
        known_shas: HashSet::new(),
        merge_in_progress: false,
    };
    assert_eq!(
        classify(Some(&before), Some(&after)),
        GitClass::ExternalUnknown
    );
}

/// A merge in progress still wins: it is checked before anything else.
#[test]
fn unreliable_observation_does_not_mask_a_merge() {
    let before = obs("main", "aaa", &["aaa"], false);
    let after = GitObservation {
        head_ref: "main".to_string(),
        head_sha: None,
        known_shas: HashSet::new(),
        merge_in_progress: true,
    };
    assert_eq!(
        classify(Some(&before), Some(&after)),
        GitClass::MergeInProgress
    );
}

#[test]
fn merge_changed_files_unions_both_parents() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("base.md"), "base\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);

    // Feature branch adds feat.md.
    run_git(root, &["checkout", "-q", "-b", "feature"]);
    std::fs::write(root.join("feat.md"), "feature\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "feat"]);

    // Main adds main.md.
    run_git(root, &["checkout", "-q", "main"]);
    std::fs::write(root.join("main.md"), "main\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "main"]);

    // A real merge commit (two parents).
    run_git(root, &["merge", "-q", "--no-ff", "-m", "merge", "feature"]);

    let sha = merge_commit_sha(root).expect("a completed merge");
    let mut changed = merge_changed_files(root, &sha);
    changed.sort();
    // Union of both parents: feat.md (from feature) + main.md (from main),
    // base.md unchanged on both sides.
    assert_eq!(changed, vec!["feat.md".to_string(), "main.md".to_string()]);
}

#[test]
fn merge_changed_files_is_empty_for_a_non_merge() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("a.md"), "x\n").unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let head = observe(root).unwrap().head_sha.unwrap();
    // A linear commit has one parent → no ^2 → the union is empty.
    assert!(merge_changed_files(root, &head).is_empty());
}
