//! WI-FL5.6 — what `run_workflow` refuses before it spawns anything, and
//! what the whole command does once it does not refuse.
//!
//! Two layers, deliberately. `admit_run` — the engine gate, the one-run CAS
//! and input validation — is exercised against a bare `WorkflowRunnerState`,
//! with no app at all, because that is where every refusal lives and each
//! test names the `CommandError` code the frontend branches on. The
//! `through_the_command` module below then drives `run_workflow` ITSELF on a
//! mock app (#263): the command is generic over the runtime, so the joins
//! around `admit_run` — the id settled, published and refused on reuse, the
//! preparation awaited, the runner spawned holding the flag — are pinned
//! rather than inferred.
//!
//! The NOT-gated property of `cancel_workflow` / `respond_workflow_approval`
//! is already pinned by `guards.test.rs` (source scan) and `state.test.rs`
//! (`request_cancel_works_while_the_engine_flag_is_off`); it is not repeated.

use super::admit_run;
use crate::command_error::ErrorCode;
use crate::workflow::state::WorkflowRunnerState;
use std::sync::atomic::Ordering;

const VALID: &str =
    "name: Test\nsteps:\n  - id: say\n    uses: action/notify\n    with:\n      message: hi\n";

fn engine_on() -> WorkflowRunnerState {
    let state = WorkflowRunnerState::default();
    state.set_engine_enabled(true);
    state
}

fn workspace() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn root(ws: &tempfile::TempDir) -> &str {
    ws.path().to_str().expect("utf-8 temp path")
}

fn steps(count: usize) -> String {
    let mut yaml = String::from("name: Many\nsteps:\n");
    for i in 0..count {
        yaml.push_str(&format!("  - id: s{i}\n    uses: action/notify\n"));
    }
    yaml
}

// ── the gate and the busy check ─────────────────────────────────────────────

#[test]
fn a_start_is_refused_with_feature_disabled_while_the_engine_is_off() {
    let state = WorkflowRunnerState::default();
    let ws = workspace();
    let err = admit_run(&state, VALID, root(&ws), "exec-admit").expect_err("engine off");
    assert_eq!(err.code(), ErrorCode::FeatureDisabled);
    assert_eq!(err.i18n_key(), Some("errors.workflow.engineDisabled"));
    assert!(
        !state.running.load(Ordering::SeqCst),
        "a refused start must not latch `running`"
    );
    assert!(state.current_execution.lock().unwrap().is_none());
}

#[test]
fn the_engine_gate_is_checked_before_the_busy_check() {
    let state = WorkflowRunnerState::default();
    state.running.store(true, Ordering::SeqCst);
    let ws = workspace();
    let err = admit_run(&state, VALID, root(&ws), "exec-admit").expect_err("engine off");
    assert_eq!(
        err.code(),
        ErrorCode::FeatureDisabled,
        "not `conflict`: the gate wins"
    );
    assert!(
        state.running.load(Ordering::SeqCst),
        "the live run's flag is untouched"
    );
}

#[test]
fn a_second_start_while_one_runs_is_refused_with_conflict() {
    let state = engine_on();
    state.running.store(true, Ordering::SeqCst);
    let ws = workspace();
    let err = admit_run(&state, VALID, root(&ws), "exec-admit").expect_err("already running");
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.workflow.alreadyRunning"));
    assert!(
        state.running.load(Ordering::SeqCst),
        "the refusal must not release someone else's flag"
    );
}

#[test]
fn a_refused_second_start_does_not_disarm_the_live_runs_cancel() {
    // `cancel_requested` is reset only AFTER the CAS is won; a start that
    // loses the CAS must leave a cancel already aimed at the live run alone.
    let state = engine_on();
    state.running.store(true, Ordering::SeqCst);
    state.cancel_requested.store(true, Ordering::SeqCst);
    let ws = workspace();
    assert_eq!(
        admit_run(&state, VALID, root(&ws), "exec-admit")
            .expect_err("busy")
            .code(),
        ErrorCode::Conflict
    );
    assert!(state.cancel_requested.load(Ordering::SeqCst));
}

// ── input validation releases the flag it took ──────────────────────────────

#[test]
fn empty_yaml_is_refused_with_invalid_input_and_releases_the_flag() {
    let state = engine_on();
    let ws = workspace();
    let err = admit_run(&state, "  \n\t", root(&ws), "exec-admit").expect_err("empty");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.workflow.emptyYaml"));
    assert!(!state.running.load(Ordering::SeqCst));
}

// #520 — the size bound runs BEFORE the parser. Every other bound here is read
// off a deserialized document, so a document that is expensive to deserialize
// has already been deserialized by the time any of them could refuse it.
#[test]
fn an_oversized_workflow_is_refused_before_it_is_parsed() {
    let state = engine_on();
    let ws = workspace();
    // Syntactically fine and far over the cap: it must be refused on SIZE, not
    // on anything the parser would have said about it.
    let huge = format!(
        "name: big\nsteps: []\n# {}\n",
        "x".repeat(super::super::validate::MAX_WORKFLOW_YAML_BYTES as usize)
    );
    let err = admit_run(&state, &huge, root(&ws), "exec-admit").expect_err("over the cap");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(err.message().contains("the limit is"), "{}", err.message());
    assert!(
        !state.running.load(Ordering::SeqCst),
        "and the flag is released"
    );
}

// A workflow the size of the largest genie file still admits: the two halves
// of the same path — reading the file and running it — agree on the bound.
#[test]
fn a_workflow_at_the_genie_read_cap_still_admits() {
    let state = engine_on();
    let ws = workspace();
    let header = "name: big\nsteps: []\n# ";
    let padding = super::super::validate::MAX_WORKFLOW_YAML_BYTES as usize - header.len() - 1;
    let at_cap = format!("{header}{}\n", "x".repeat(padding));
    assert_eq!(
        at_cap.len() as u64,
        super::super::validate::MAX_WORKFLOW_YAML_BYTES
    );
    admit_run(&state, &at_cap, root(&ws), "exec-admit").expect("exactly at the cap is fine");
}

#[test]
fn a_missing_workspace_is_refused_with_invalid_input() {
    let state = engine_on();
    let ws = workspace();
    let missing = ws.path().join("nope");
    let err =
        admit_run(&state, VALID, missing.to_str().unwrap(), "exec-admit").expect_err("no such dir");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.workflow.invalidWorkspace"));
    assert!(
        err.message().contains("nope"),
        "names the path: {}",
        err.message()
    );
    assert!(!state.running.load(Ordering::SeqCst));
}

#[test]
fn unparseable_yaml_is_refused_with_invalid_input() {
    let state = engine_on();
    let ws = workspace();
    let err =
        admit_run(&state, "name: [unclosed\n", root(&ws), "exec-admit").expect_err("bad YAML");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.workflow.parseFailed"));
    assert!(!state.running.load(Ordering::SeqCst));
}

#[test]
fn more_than_fifty_steps_is_refused_with_invalid_input() {
    let state = engine_on();
    let ws = workspace();
    let err = admit_run(&state, &steps(51), root(&ws), "exec-admit").expect_err("51 steps");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.workflow.tooManySteps"));
    assert!(
        err.message().contains("51"),
        "names the count: {}",
        err.message()
    );
    assert!(!state.running.load(Ordering::SeqCst));
}

#[test]
fn fifty_steps_is_the_last_admitted_count() {
    let state = engine_on();
    let ws = workspace();
    let (workflow, _, _admission) =
        admit_run(&state, &steps(50), root(&ws), "exec-admit").expect("50 is allowed");
    assert_eq!(workflow.steps.len(), 50);
    assert!(
        state.running.load(Ordering::SeqCst),
        "an admitted run holds the flag"
    );
}

#[test]
fn a_webhook_step_is_refused_as_unsupported_before_anything_runs() {
    let state = engine_on();
    let ws = workspace();
    let yaml = "name: Hooked\nsteps:\n  - id: first\n    uses: action/notify\n  - id: hook\n    uses: webhook/stripe\n";
    let err =
        admit_run(&state, yaml, root(&ws), "exec-admit").expect_err("webhooks are not implemented");
    assert_eq!(err.code(), ErrorCode::Unsupported);
    assert_eq!(
        err.i18n_key(),
        Some("errors.workflow.webhookNotImplemented")
    );
    let message = err.message();
    assert!(
        message.contains('2') && message.contains("hook"),
        "names index and id: {message}"
    );
    assert!(!state.running.load(Ordering::SeqCst));
}

// ── an admitted run ─────────────────────────────────────────────────────────

#[test]
fn an_admitted_run_holds_the_flag_and_clears_a_stale_cancel() {
    let state = engine_on();
    state.cancel_requested.store(true, Ordering::SeqCst);
    let ws = workspace();
    let (workflow, workspace, admission) =
        admit_run(&state, VALID, root(&ws), "exec-admit").expect("admitted");
    assert_eq!(workflow.steps.len(), 1);
    assert_eq!(workspace, ws.path().canonicalize().expect("canonical"));
    assert!(state.running.load(Ordering::SeqCst));
    assert!(
        !state.cancel_requested.load(Ordering::SeqCst),
        "a stale cancel from a previous run must not stop this one"
    );
    // #259: the flag is released by the guard, not by a store on every path.
    drop(admission);
    assert!(
        !state.running.load(Ordering::SeqCst),
        "dropping the admission releases the flag"
    );
}

// ── #261: the workspace reaches the sandbox canonical ───────────────────────

#[test]
fn a_workspace_root_with_dot_dot_segments_is_admitted_as_its_canonical_path() {
    let state = engine_on();
    let ws = workspace();
    let sub = ws.path().join("sub");
    std::fs::create_dir(&sub).expect("mkdir");
    let indirect = sub.join("..");
    let (_, workspace, _admission) =
        admit_run(&state, VALID, indirect.to_str().unwrap(), "exec-admit").expect("admitted");
    assert_eq!(workspace, ws.path().canonicalize().expect("canonical"));
    assert!(
        !workspace
            .components()
            .any(|c| c == std::path::Component::ParentDir),
        "no `..` survives admission: {}",
        workspace.display()
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_workspace_root_is_admitted_as_its_target() {
    let state = engine_on();
    let ws = workspace();
    let link_dir = tempfile::tempdir().expect("link dir");
    let link = link_dir.path().join("ws-link");
    std::os::unix::fs::symlink(ws.path(), &link).expect("symlink");
    let (_, workspace, _admission) =
        admit_run(&state, VALID, link.to_str().unwrap(), "exec-admit").expect("admitted");
    assert_eq!(workspace, ws.path().canonicalize().expect("canonical"));
}

#[test]
fn a_workspace_root_that_is_a_file_is_refused_with_invalid_input() {
    let state = engine_on();
    let ws = workspace();
    let file = ws.path().join("not-a-dir");
    std::fs::write(&file, "x").expect("write");
    let err = admit_run(&state, VALID, file.to_str().unwrap(), "exec-admit").expect_err("a file");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(!state.running.load(Ordering::SeqCst));
}

// ── #263: the command itself, driven on a mock runtime ──────────────────────
//
// `admit_run` above is the pre-spawn half, and testing only that left the four
// JOINS around it unpinned: the id settled and published, the preparation
// awaited, the runner spawned with the flag handed to it, and the caller's id
// returned. `run_workflow` is generic over the runtime, so the real command
// body runs here against a real `WorkflowRunnerState` on a mock app.

// tauri::test::MockRuntime dies at startup on windows-latest
// (STATUS_ENTRYPOINT_NOT_FOUND), and the `test` feature of tauri is not
// enabled there — same gate as every other mock-runtime suite in this crate.
#[cfg(not(target_os = "windows"))]
mod through_the_command {
    use super::{engine_on, root, workspace, VALID};
    use crate::command_error::ErrorCode;
    use crate::workflow::commands::run_workflow;
    use crate::workflow::state::WorkflowRunnerState;
    use std::collections::HashMap;
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    fn mock_app(state: WorkflowRunnerState) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        app.manage(state);
        app
    }

    /// The spawned runner owns the flag until it ends; every assertion about
    /// an IDLE state waits for that rather than racing it.
    async fn wait_until_idle(app: &tauri::App<tauri::test::MockRuntime>) {
        for _ in 0..300 {
            if !app
                .state::<WorkflowRunnerState>()
                .running
                .load(Ordering::SeqCst)
            {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("the spawned run never released the `running` flag");
    }

    #[tokio::test]
    async fn a_start_returns_the_callers_id_and_the_spawned_run_releases_the_flag() {
        let app = mock_app(engine_on());
        let ws = workspace();

        let id = run_workflow(
            app.handle().clone(),
            VALID.into(),
            HashMap::new(),
            root(&ws).to_string(),
            None,
            Some("run-a".into()),
            app.state(),
        )
        .await
        .expect("an action-only workflow starts");

        assert_eq!(
            id, "run-a",
            "the caller's id is the one events are keyed on"
        );
        // The flag was handed to the runner task, not released by the command.
        wait_until_idle(&app).await;
        assert!(
            app.state::<WorkflowRunnerState>()
                .current_execution
                .lock()
                .unwrap()
                .is_none(),
            "the finished run's id is cleared with its flag"
        );
    }

    /// #264 through the command: an id a run already carried is refused, and
    /// the refusal releases the claim it took rather than latching `running`.
    #[tokio::test]
    async fn an_execution_id_is_refused_the_second_time_and_the_flag_is_released() {
        let app = mock_app(engine_on());
        let ws = workspace();
        let start = |id: &str| {
            run_workflow(
                app.handle().clone(),
                VALID.into(),
                HashMap::new(),
                root(&ws).to_string(),
                None,
                Some(id.to_string()),
                app.state(),
            )
        };

        start("run-b").await.expect("first use");
        wait_until_idle(&app).await;

        let err = start("run-b").await.expect_err("the id is spent");
        assert_eq!(err.code(), ErrorCode::Conflict);
        assert!(
            !app.state::<WorkflowRunnerState>()
                .running
                .load(Ordering::SeqCst),
            "a refusal after the claim must not latch the flag"
        );
    }

    /// The id is validated before anything is built from it (#264): a
    /// traversal id never reaches a snapshot directory name, and the refusal
    /// leaves neither the flag nor a published id behind.
    #[tokio::test]
    async fn a_hostile_execution_id_is_refused_and_nothing_is_left_running() {
        let app = mock_app(engine_on());
        let ws = workspace();

        let err = run_workflow(
            app.handle().clone(),
            VALID.into(),
            HashMap::new(),
            root(&ws).to_string(),
            None,
            Some("../../evil".into()),
            app.state(),
        )
        .await
        .expect_err("a path separator is not an execution id");

        assert_eq!(err.code(), ErrorCode::InvalidInput);
        let state = app.state::<WorkflowRunnerState>();
        assert!(!state.running.load(Ordering::SeqCst));
        assert!(state.current_execution.lock().unwrap().is_none());
    }

    /// The gate is enforced by the COMMAND, not only by the UI (WI-19) — and
    /// the whole command, not just `admit_run`, is what a replayed invoke
    /// reaches.
    #[tokio::test]
    async fn the_engine_gate_refuses_the_command_itself() {
        let app = mock_app(WorkflowRunnerState::default());
        let ws = workspace();

        let err = run_workflow(
            app.handle().clone(),
            VALID.into(),
            HashMap::new(),
            root(&ws).to_string(),
            None,
            None,
            app.state(),
        )
        .await
        .expect_err("the engine is off");

        assert_eq!(err.code(), ErrorCode::FeatureDisabled);
        assert!(!app
            .state::<WorkflowRunnerState>()
            .running
            .load(Ordering::SeqCst));
    }

    /// No caller id: the command mints one, returns it, and it is the id the
    /// run is published under.
    #[tokio::test]
    async fn a_start_without_a_caller_id_gets_a_fresh_one() {
        let app = mock_app(engine_on());
        let ws = workspace();

        let id = run_workflow(
            app.handle().clone(),
            VALID.into(),
            HashMap::new(),
            root(&ws).to_string(),
            None,
            None,
            app.state(),
        )
        .await
        .expect("starts");

        assert_eq!(id.len(), 36, "a UUID: {id}");
        wait_until_idle(&app).await;
    }
}

// ── the graph, the wire shape and the save target are settled at ADMISSION ──

/// #522 — a graph the runner cannot sort is refused SYNCHRONOUSLY.
///
/// `topological_sort` fails on the runner's first line, before it emits
/// `workflow:complete`, while `run_workflow` had already returned `Ok` with an
/// execution id the frontend was subscribed to. The run neither started nor
/// finished and the panel waited forever, with a log line as the only trace.
#[test]
fn a_dependency_cycle_is_refused_at_admission_not_by_the_spawned_runner() {
    let state = engine_on();
    let ws = workspace();
    let yaml = "name: cyclic\nsteps:\n  - id: a\n    uses: action/copy\n    needs: b\n  \
                - id: b\n    uses: action/copy\n    needs: a\n";
    let err = admit_run(&state, yaml, root(&ws), "exec-cycle").expect_err("a cycle");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert!(
        !state.running.load(Ordering::SeqCst),
        "the flag is released"
    );
}

#[test]
fn a_duplicate_step_id_is_refused_at_admission() {
    let state = engine_on();
    let ws = workspace();
    let yaml = "name: dup\nsteps:\n  - id: a\n    uses: action/copy\n  \
                - id: a\n    uses: action/copy\n";
    let err = admit_run(&state, yaml, root(&ws), "exec-dup").expect_err("duplicate id");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}

/// #519 — an unknown key is an author error, and silence is the wrong answer.
///
/// `need:` for `needs:` drops a dependency edge and reorders execution;
/// `approvals:` for `approval:` reverts a step to the workflow default, which
/// for an engine that spawns AI providers and writes files means running
/// unattended what the author asked to be approved.
#[test]
fn a_mistyped_step_key_is_refused_rather_than_ignored() {
    let state = engine_on();
    let ws = workspace();
    // A fresh id per case: an execution id is used once (#264), so reusing one
    // would refuse the second case with `conflict` before it was parsed.
    for (i, yaml) in [
        "name: typo\nsteps:\n  - id: a\n    uses: action/copy\n  \
         - id: b\n    uses: action/copy\n    need: a\n",
        "name: typo\nsteps:\n  - id: a\n    uses: action/copy\n    approvals: ask\n",
    ]
    .into_iter()
    .enumerate()
    {
        let err =
            admit_run(&state, yaml, root(&ws), &format!("exec-typo-{i}")).expect_err("unknown key");
        assert_eq!(err.code(), ErrorCode::InvalidInput);
        assert_eq!(err.i18n_key(), Some("errors.workflow.parseFailed"));
    }
}

/// #521/#551 — a save target the pre-run snapshot cannot identify is refused.
///
/// `with` values carry the full expression grammar, resolved by the RUNNER —
/// long after the snapshot was taken from the literal string. A dynamic path
/// made the snapshot protect a placeholder while `save-file` overwrote a real,
/// existing file that had never been copied.
#[test]
fn a_dynamic_save_file_path_is_refused_because_it_cannot_be_snapshotted() {
    let state = engine_on();
    let ws = workspace();
    for (i, path) in ["${{ env.OUT }}", "out-${VERSION}.md"]
        .into_iter()
        .enumerate()
    {
        let yaml = format!(
            "name: dyn\nsteps:\n  - id: s\n    uses: action/save-file\n    \
             with:\n      path: \"{path}\"\n      input: hi\n"
        );
        let err = admit_run(&state, &yaml, root(&ws), &format!("exec-dyn-{i}"))
            .expect_err("dynamic path");
        assert_eq!(err.code(), ErrorCode::InvalidInput);
        assert!(err.message().contains("snapshot"), "{}", err.message());
    }
    // A literal path is untouched.
    let yaml = "name: ok\nsteps:\n  - id: s\n    uses: action/save-file\n    \
                with:\n      path: out.md\n      input: hi\n";
    admit_run(&state, yaml, root(&ws), "exec-literal").expect("a literal target is admitted");
}

/// A dynamic value anywhere ELSE stays dynamic — the refusal is scoped to the
/// one field the snapshot has to know in advance.
#[test]
fn a_dynamic_save_file_input_is_still_allowed() {
    let state = engine_on();
    let ws = workspace();
    let yaml = "name: ok\nsteps:\n  - id: a\n    uses: action/copy\n    \
                with:\n      input: seed\n  - id: s\n    uses: action/save-file\n    \
                needs: a\n    with:\n      path: out.md\n      \
                input: ${{ steps.a.outputs.text }}\n";
    admit_run(&state, yaml, root(&ws), "exec-dyn-input").expect("only the PATH is constrained");
}
