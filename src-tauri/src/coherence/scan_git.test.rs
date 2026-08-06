// Git-side scan behaviour, split from scan.test.rs for the 800-line test-file
// limit. These are the tests that drive REAL git repositories (and the injected
// observer), as opposed to scan.test.rs's content-walk and identity cases.
//
// @coordinates-with scan_git.rs — the phase under test
// @coordinates-with scan.test.rs — the module this was split from

use super::*;
use crate::coherence::capture::{capture, CaptureRequest};
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, Intent, WriterId};
use std::path::Path;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    (dir, kernel)
}

fn captured_doc(kernel: &mut WorkspaceKernel, root: &Path, rel: &str, body: &str) -> String {
    write_file(root, rel, body);
    let receipt = capture(
        kernel,
        CaptureRequest {
            path: rel.into(),
            content: body.into(),
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
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    receipt
        .content_with_identity
        .unwrap_or_else(|| body.to_string())
}

fn write_file(root: &Path, rel: &str, content: &str) {
    let abs = root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, content).unwrap();
}

// ── git integration (real repos) ────────────────────────────────────────

fn run_git(dir: &Path, args: &[&str]) {
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
fn git_navigation_never_mints_revisions() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    let v1 = captured_doc(&mut kernel, root, "a.md", "version-one\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let v2 = v1.replace("version-one", "version-two");
    write_file(root, "a.md", &v2);
    capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: v2,
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
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2"]);

    // Baseline observation, then navigate back in history.
    scan_workspace(&mut kernel).unwrap();
    run_git(root, &["checkout", "-q", "HEAD~1"]);
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.navigations, 1, "navigation recorded");
    assert_eq!(
        report.external_edits, 0,
        "NO revision minted from navigation (R18)"
    );
    assert_eq!(report.git_mutations, 0);
    // Note: the checkout also rewound the git-TRACKED ledger segment to
    // its older committed state — absolute entry counts shrink by design
    // (union merge heals across branches). Assert the shape instead:
    // exactly one navigation entry, zero transformations minted by scan.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let navs = entries.iter().filter(|e| e.kind == "navigation").count();
    assert_eq!(navs, 1, "exactly one navigation entry in the ledger");
}

#[test]
fn git_revert_is_captured_as_git_mutation() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    let v1 = captured_doc(&mut kernel, root, "a.md", "one\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c1"]);
    let v2 = v1.replace("one", "two");
    write_file(root, "a.md", &v2);
    capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: v2,
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
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "c2"]);
    scan_workspace(&mut kernel).unwrap(); // baseline

    // The ledger is git-TRACKED (git-as-transport), so `git add .` above committed
    // it and this revert takes the capture entry WITH the content — verified here,
    // not assumed: the entry count drops.
    let entries_before = kernel.ledger().read_all().unwrap().entries.len();
    run_git(root, &["revert", "--no-edit", "HEAD"]);
    let entries_after = kernel.ledger().read_all().unwrap().entries.len();
    assert_eq!(
        (entries_before, entries_after),
        (3, 2),
        "the revert reverted history too, not just content"
    );

    let report = scan_workspace(&mut kernel).unwrap();
    // Spec §9.4 (audit R5/A22) says a revert is a MUTATION: restoring historical
    // content mints a NEW git-attributed revision parented on the current head
    // (A → B → A ≠ A). That holds only while the HISTORY survives the revert.
    // Here it does not: reverting a ledger-bearing commit rolls the head back to
    // the v1 revision, and the disk content is v1 — they agree, so there is
    // genuinely nothing to mint, and minting would parent on a revision the ledger
    // no longer contains (a dangling parent).
    //
    // This assertion was `git_mutations == 1` until scan was brought under the
    // workspace lock (7th-review 6R-1). It passed only because scan compared
    // against a STALE index that still held the reverted-away head — an artifact
    // of the very TOCTOU that fix closed, not evidence of correct behaviour.
    // The A → B → A ≠ A principle itself remains covered by
    // `external_a_b_a_edit_mints_a_new_revision` below, where history is intact.
    // NOTE FOR THE OWNER: spec §9.4 is worth clarifying to say "when history
    // survives the revert" — flagged rather than silently reinterpreted.
    assert_eq!(report.external_edits, 0);
    assert_eq!(
        report.git_mutations, 0,
        "history was reverted with the content, so head == disk and nothing is minted"
    );
}

#[test]
fn external_a_b_a_edit_mints_a_new_revision() {
    // Spec §2.3 / audit R5: recreating old content by hand is NEW history
    // (same content hash, different parents) — never silently absorbed.
    let (dir, mut kernel) = workspace();
    let v1 = captured_doc(&mut kernel, dir.path(), "a.md", "alpha\n");
    let v2 = v1.replace("alpha", "beta");
    write_file(dir.path(), "a.md", &v2);
    scan_workspace(&mut kernel).unwrap();
    // vim-style revert back to the exact v1 content:
    write_file(dir.path(), "a.md", &v1);
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(report.external_edits, 1, "A->B->A mints, not absorbs");
    // The object now has a LINEAR 3-revision history (v1, v2, v1-again).
    let registry = kernel.index().registry_state().unwrap();
    let object = *registry.object_at.get("a.md").unwrap();
    assert_eq!(kernel.index().heads(&object).unwrap().len(), 1, "no fork");
}

#[test]
fn duplicate_ids_capture_hold_and_release() {
    // Spec §2.1: duplicates hold capture; resolving the set releases it.
    let (dir, mut kernel) = workspace();
    let with_id = captured_doc(&mut kernel, dir.path(), "a.md", "original\n");
    write_file(dir.path(), "z-copy.md", &with_id);
    scan_workspace(&mut kernel).unwrap();
    let registry = kernel.index().registry_state().unwrap();
    let object = *registry.object_at.get("a.md").unwrap();
    assert!(
        kernel.index().is_held(&object).unwrap(),
        "held while duplicated"
    );
    let err = capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: with_id.replace("original", "edited"),
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
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap_err();
    assert!(err.contains("capture-held"), "{err}");
    // Resolve the duplicate: delete the copy; the next scan releases.
    std::fs::remove_file(dir.path().join("z-copy.md")).unwrap();
    scan_workspace(&mut kernel).unwrap();
    assert!(
        !kernel.index().is_held(&object).unwrap(),
        "released after resolution"
    );
}

#[test]
fn capture_rejects_traversal_paths() {
    // Audit R1: the IPC boundary guard.
    let (_dir, mut kernel) = workspace();
    for bad in ["../outside.md", "/etc/passwd", "a\\b.md"] {
        let err = capture(
            &mut kernel,
            CaptureRequest {
                path: (*bad).into(),
                content: "x\n".into(),
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
                rewrite_identity: true,
                idem: None,
            },
        );
        assert!(err.is_err(), "{bad:?} must be rejected");
    }
}

#[test]
fn crlf_content_parses_and_hashes_like_lf() {
    // Audit R14c: CRLF from external clients must not duplicate identity
    // blocks or fork hashes.
    let (dir, mut kernel) = workspace();
    let lf = captured_doc(&mut kernel, dir.path(), "a.md", "line one\nline two\n");
    // Re-save the identity-bearing content with CRLF endings:
    let crlf = lf.replace('\n', "\r\n");
    write_file(dir.path(), "a.md", &crlf);
    let receipt = capture(
        &mut kernel,
        CaptureRequest {
            path: "a.md".into(),
            content: crlf,
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
            rewrite_identity: true,
            idem: None,
        },
    )
    .unwrap();
    assert!(
        receipt.entry_id.is_none(),
        "same canonical content = no-op, no fork"
    );
}

// WI-3.7 — completed-merge diagnostic: appended once per merge SHA,
// idempotent across repeated scans; mid-conflict merges defer (D3.3).
#[test]
fn completed_merge_emits_one_deduped_diagnostic() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    captured_doc(&mut kernel, root, "a.md", "base\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "base"]);
    // A feature branch with its own commit.
    run_git(root, &["checkout", "-q", "-b", "feature"]);
    write_file(root, "b.md", "feature work\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "feature"]);
    // Back to main, make it diverge, then a real (non-fast-forward) merge.
    run_git(root, &["checkout", "-q", "main"]);
    write_file(root, "c.md", "main work\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "main-work"]);
    run_git(
        root,
        &["merge", "-q", "--no-ff", "-m", "merge feature", "feature"],
    );

    // Baseline scan already ran inside captured_doc? Run explicitly.
    let r1 = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r1.merges, 1, "the completed merge is recorded once");
    // A second scan of the same merge is a no-op (idempotent).
    let r2 = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r2.merges, 0, "repeated scan does not re-record");

    // The diagnostic is in the ledger, surfaced pull-only.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let merge_diags = entries
        .iter()
        .filter(|e| e.kind == "diagnostic" && e.body["code"] == "merge-completed")
        .count();
    assert_eq!(merge_diags, 1);
}

#[test]
fn linear_head_emits_no_merge_diagnostic() {
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    captured_doc(&mut kernel, root, "a.md", "base\n");
    run_git(root, &["add", "."]);
    run_git(root, &["commit", "-q", "-m", "base"]);
    let r = scan_workspace(&mut kernel).unwrap();
    assert_eq!(r.merges, 0);
}

#[test]
fn path_under_ignored_dir_edge_cases() {
    // Under an ignored dir (both separators) — true.
    assert!(path_under_ignored_dir("node_modules/lib.md"));
    assert!(path_under_ignored_dir("node_modules\\lib.md")); // audit #3: Windows
    assert!(path_under_ignored_dir("a/.git/config.md"));
    // Not under an ignored dir.
    assert!(!path_under_ignored_dir("notes/lib.md"));
    assert!(!path_under_ignored_dir("node_modules")); // audit #3: leaf, a real file
    assert!(!path_under_ignored_dir("notes/node_modules.md")); // not the segment
    assert!(!path_under_ignored_dir("lib.md"));
}

#[test]
fn path_prefix_ignores_cover_nested_worktrees_only() {
    // A git worktree checked out INSIDE the repo (`.claude/worktrees/<name>`)
    // is a second copy of the same tracked files, so every doc there collides
    // with its main-checkout twin on `vmark.id`. The skip is anchored to the
    // PATH, not a bare dir name: `.claude` itself stays scannable.
    assert!(path_under_ignored_dir(
        ".claude/worktrees/refactor/dev-docs/a.md"
    ));
    assert!(path_under_ignored_dir(".claude\\worktrees\\refactor\\a.md")); // Windows
                                                                           // The rest of `.claude/` is ordinary content and must NOT be skipped.
    assert!(!path_under_ignored_dir(".claude/rules/10-tdd.md"));
    assert!(!path_under_ignored_dir(".claude/agents/auditor.md"));
    // Boundary: a sibling file whose name merely starts with the prefix.
    assert!(!path_under_ignored_dir(".claude/worktrees.md"));
    // Only anchored at the workspace root — a nested lookalike is real content.
    assert!(!path_under_ignored_dir("docs/.claude/worktrees/a.md"));
}

#[test]
fn nested_worktree_docs_are_never_scanned() {
    // The duplicate-id storm this fixes: the worktree copy carries the SAME
    // vmark.id as the main-checkout file, so scanning both emits a
    // `duplicate-id` diagnostic per doc. Skipping the worktree keeps the
    // main copy authoritative and the ledger quiet.
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "seed.md", "init\n");
    write_file(
        dir.path(),
        ".claude/worktrees/refactor/dup.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b2201\n---\nx\n",
    );
    // A real doc elsewhere under .claude/ IS still adopted — the skip is narrow.
    write_file(
        dir.path(),
        ".claude/rules/real.md",
        "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b2202\n---\ny\n",
    );
    let report = scan_workspace(&mut kernel).unwrap();
    assert_eq!(
        report.adopted, 1,
        "only .claude/rules/real.md is adopted; the worktree copy is skipped"
    );
}

#[test]
fn registered_path_under_nested_worktree_is_never_marked_absent() {
    // Same guarantee as audit C8, for the path-prefix skip: objects already
    // registered under `.claude/worktrees/` (this repo has 10) must not be
    // reconciled as deleted just because the walk stopped descending there.
    let (dir, mut kernel) = workspace();
    captured_doc(
        &mut kernel,
        dir.path(),
        ".claude/worktrees/refactor/dev-docs/a.md",
        "keep\n",
    );
    let report = scan_workspace(&mut kernel).unwrap();
    assert!(report.complete, "tiny tree walks completely");
    assert_eq!(
        report.absent_marked, 0,
        "a nested-worktree path must never be marked absent"
    );
}

#[test]
fn registered_path_under_ignored_dir_is_never_marked_absent() {
    // Audit C8: an object registered at a path the walk never descends
    // into (node_modules, .Trash, …) must not be reconciled as deleted —
    // its absence from the walk is not evidence the file is gone.
    let (dir, mut kernel) = workspace();
    captured_doc(&mut kernel, dir.path(), "node_modules/lib.md", "keep\n");
    // The file still exists on disk; the walk simply never visits it.
    let report = scan_workspace(&mut kernel).unwrap();
    assert!(report.complete, "tiny tree walks completely");
    assert_eq!(
        report.absent_marked, 0,
        "an ignored-dir path must never be marked absent"
    );
}

// ── WI-4.2: the unreliable-observation guard (#1207) ─────────────────────

/// A stub observer standing in for a `git` read that FAILED rather than a
/// repository that changed: it still reports a repo (`Some`), but cannot
/// resolve a HEAD. That distinction is the whole point — a bare `None` means
/// "not a git repo" and classifies as `ExternalUnknown`, which reconciles
/// normally. Only Some-with-no-HEAD, against a prior observation that HAD one,
/// is the impossible transition that proves the read broke.
fn head_unresolvable(_root: &Path) -> crate::coherence::gitops::GitOutcome {
    crate::coherence::gitops::GitOutcome::Observed(crate::coherence::gitops::GitObservation {
        head_ref: "main".into(),
        head_sha: None,
        known_shas: Default::default(),
        merge_in_progress: false,
    })
}

/// The other half of the same bug (audit finding #3): production `observe`
/// returns NOTHING when `git` itself fails — `.git` is there, but the command
/// errored. That used to collapse into the same `None` as "not a repository",
/// classify as `ExternalUnknown`, and let the scan proceed and overwrite its
/// good baseline with the failure.
fn git_unreadable(_root: &Path) -> crate::coherence::gitops::GitOutcome {
    crate::coherence::gitops::GitOutcome::Unreadable
}

#[test]
fn a_failed_git_read_is_refused_and_does_not_poison_the_baseline() {
    // #1207: a repo that HAD a resolvable HEAD now reports none. Reconciling on
    // that would mint a spurious external-edit revision for what is really a
    // git mutation. The scan must refuse — AND must not store the bad
    // observation, or the next scan would compare against it and mint anyway,
    // turning a one-cycle transient into permanent corruption.
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    write_file(root, "a.md", "hello\n");
    run_git(root, &["add", "-A"]);
    run_git(root, &["commit", "-qm", "one"]);

    // A real, healthy baseline observation.
    let baseline = crate::coherence::gitops::observe(root).expect("a git repo");
    assert!(
        baseline.head_sha.is_some(),
        "precondition: the baseline resolved a HEAD"
    );
    kernel.last_git = Some(baseline.clone());

    let report = scan_workspace_with(&mut kernel, head_unresolvable).unwrap();

    assert!(
        report.git_observation_unreliable,
        "a failed git read must be reported, not silently reconciled"
    );
    assert_eq!(
        report.external_edits, 0,
        "no external-edit revision may be minted from an unreliable observation (#1207)"
    );
    assert_eq!(
        kernel.last_git.as_ref().map(|o| o.head_sha.clone()),
        Some(baseline.head_sha.clone()),
        "the good baseline must survive: storing the bad observation would make \
         the NEXT scan reconcile against it, so a transient failure would become \
         permanent corruption"
    );
}

#[test]
fn a_healthy_observation_still_scans_through_the_same_seam() {
    // The seam must not change behaviour on the normal path — otherwise the
    // test above would be proving something about the stub, not about the scan.
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    write_file(root, "a.md", "hello\n");
    run_git(root, &["add", "-A"]);
    run_git(root, &["commit", "-qm", "one"]);

    let report =
        scan_workspace_with(&mut kernel, crate::coherence::gitops::observe_outcome).unwrap();
    assert!(!report.git_observation_unreliable);
    assert!(report.complete);
}

#[test]
fn a_git_command_failure_is_also_refused_and_preserves_the_baseline() {
    // Audit finding #3. The guard used to fire ONLY for the narrow case where
    // git resolved a branch name but not a SHA. The far commoner shape — the
    // `git` invocation failing outright on a repo that has commits — fell
    // through to ExternalUnknown, so the scan ran and then replaced the good
    // baseline with the failure. Same bug class as #1207, missed by the guard
    // built for it.
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    write_file(root, "a.md", "hello\n");
    run_git(root, &["add", "-A"]);
    run_git(root, &["commit", "-qm", "one"]);

    let baseline = crate::coherence::gitops::observe(root).expect("a git repo");
    assert!(
        baseline.head_sha.is_some(),
        "precondition: baseline has a head"
    );
    kernel.last_git = Some(baseline.clone());

    let report = scan_workspace_with(&mut kernel, git_unreadable).unwrap();

    assert!(
        report.git_observation_unreliable,
        "a git read that failed outright must be refused too"
    );
    assert_eq!(
        kernel.last_git.as_ref().map(|o| o.head_sha.clone()),
        Some(baseline.head_sha.clone()),
        "the good baseline must survive a failed git read"
    );
}

#[test]
fn an_unborn_repo_is_not_treated_as_an_unreliable_read() {
    // The trap in fixing finding #3: `git init` with no commits ALSO fails
    // `rev-parse HEAD`, so "git would not answer" cannot by itself mean
    // "unreliable" — that would make every freshly created repository refuse to
    // scan, which is worse than the bug. With no head-bearing baseline there is
    // nothing to contradict, so this must keep its existing handling.
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]); // no commits

    let report = scan_workspace_with(&mut kernel, crate::coherence::gitops::observe_outcome)
        .expect("an unborn repo must still scan");
    assert!(
        !report.git_observation_unreliable,
        "an unborn repo is not a failed observation"
    );
}

#[test]
fn a_first_scan_git_failure_is_refused_even_with_no_baseline() {
    // Audit round 2 residual on finding #3. The first fix decided "unreliable"
    // by contradicting the PREVIOUS observation — which cannot work on the
    // first scan, because there is no previous observation. A git failure with
    // no baseline therefore still fell through to ordinary reconciliation and
    // could mint external-edit history: the exact #1207 shape, surviving the
    // fix for it.
    //
    // `Unreadable` is now unambiguous (it means git could not answer AT ALL,
    // distinguished from an unborn repo by `rev-parse --git-dir`), so it can be
    // refused on its own without needing a baseline to argue with.
    let (dir, mut kernel) = workspace();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]);
    write_file(root, "a.md", "hello\n");
    run_git(root, &["add", "-A"]);
    run_git(root, &["commit", "-qm", "one"]);

    assert!(kernel.last_git.is_none(), "precondition: no baseline yet");

    let report = scan_workspace_with(&mut kernel, git_unreadable).unwrap();

    assert!(
        report.git_observation_unreliable,
        "a failed git read must be refused on the FIRST scan too"
    );
    assert_eq!(
        report.external_edits, 0,
        "no history may be minted from a reading we could not take"
    );
    assert!(
        kernel.last_git.is_none(),
        "a failed reading must never become the baseline"
    );
}

#[test]
fn an_unborn_repo_is_distinguished_from_an_unreadable_one() {
    // The discriminator that makes the test above safe: `git init` with no
    // commits is a real state (git answers `rev-parse --git-dir` fine), not a
    // failed reading. Without this split, refusing on Unreadable would refuse
    // every freshly created repository.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    run_git(root, &["init", "-q", "-b", "main"]); // no commits
    assert_eq!(
        crate::coherence::gitops::observe_outcome(root),
        crate::coherence::gitops::GitOutcome::Unborn,
        "an unborn repo is Unborn, never Unreadable"
    );

    // A `.git` that git cannot make sense of IS unreadable.
    let broken = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(broken.path().join(".git")).unwrap();
    assert_eq!(
        crate::coherence::gitops::observe_outcome(broken.path()),
        crate::coherence::gitops::GitOutcome::Unreadable,
        "a .git git cannot read is Unreadable, never Unborn"
    );
}

/// Audit round 3 — the REGRESSION my round-2 fix introduced.
///
/// Making `Unreadable` unconditionally `ObservationUnreliable` meant a machine
/// with NO GIT BINARY could never reconcile a git-backed workspace again: the
/// spawn failure became `Unreadable`, every scan stopped, and ordinary edits
/// were never captured. That breaks the contract `git_output` documents in this
/// very module — "not a git repo (or git unavailable) — callers then treat every
/// change as an ordinary external edit, which is the safe fallback".
///
/// "git is not installed" is a fact about the MACHINE and must degrade to
/// non-git behaviour. "git ran and refused" is a fact about the REPOSITORY and
/// must stop the scan. Tested through the pure mapping so it does not require
/// uninstalling git.
#[test]
fn a_missing_git_binary_degrades_instead_of_blocking_every_scan() {
    use crate::coherence::gitops::{outcome_for_git_dir_probe, GitOutcome, GitRun};
    assert_eq!(
        outcome_for_git_dir_probe(&GitRun::Unavailable),
        Some(GitOutcome::NotGit),
        "no git binary must fall back to non-git behaviour, never block the workspace"
    );
    assert_eq!(
        outcome_for_git_dir_probe(&GitRun::Failed),
        Some(GitOutcome::Unreadable),
        "git ran and refused: that IS a repository we cannot read"
    );
    assert_eq!(
        outcome_for_git_dir_probe(&GitRun::Ok(".git".into())),
        None,
        "a working probe keeps observing"
    );
}

/// The scan must load the revision DAG a BOUNDED number of times — not once
/// per file.
///
/// `CoherenceIndex::heads` is `load_dag()?.heads(object)`: it reads every
/// revision in the workspace to answer a question about one object. Calling it
/// inside the per-file loop made a scan O(files x revisions), and a scan runs
/// on every breakdown/status pull, so opening the panel on a 300-file workspace
/// took ~380 ms of which ~99% was this.
///
/// Pinned structurally rather than by timing: the regression produces IDENTICAL
/// results and only costs more, so no correctness test can see it, and a
/// wall-clock assertion would be flaky. The bound is deliberately generous —
/// this catches "once per file", not a change from one load to two.
#[test]
fn scan_loads_the_revision_dag_once_per_scan() {
    use std::sync::atomic::Ordering;

    let (dir, mut kernel) = workspace();
    let root = dir.path();
    let files = 12usize;
    for d in 0..files {
        let name = format!("doc{d}.md");
        write_file(root, &name, "v0\n");
        captured_doc(&mut kernel, root, &name, "v0\n");
    }

    kernel.index().load_dag_calls.store(0, Ordering::Relaxed);
    scan_workspace(&mut kernel).unwrap();
    let calls = kernel.index().load_dag_calls.load(Ordering::Relaxed);

    assert!(
        calls < files,
        "a scan loaded the whole revision DAG {calls} times for {files} files — \
         that is the per-file load_dag regression (O(files x revisions)); it must \
         be hoisted out of the walk"
    );
}
