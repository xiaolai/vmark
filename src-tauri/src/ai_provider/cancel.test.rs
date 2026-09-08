//! Tests for the per-request cancel registry and `cancel_ai_prompt`
//! (cancel.rs) — audit #375.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
// Used only by the unix-gated kill test; `-D warnings` on the Windows leg
// makes an unused import fatal.
#[cfg(unix)]
use std::time::{Duration, Instant};

// ===== Registry ============================================================

#[test]
fn cancel_fires_the_registered_token() {
    let registry = AiPromptCancelRegistry::default();
    let live = registry.register("r1").expect("a fresh id registers");
    let token = live.token();
    assert!(!token.is_cancelled());

    assert!(registry.cancel("r1"), "a live request reports as cancelled");
    assert!(token.is_cancelled());
    // Idempotent while the request is still winding down.
    assert!(registry.cancel("r1"));
}

#[test]
fn cancel_of_an_unknown_id_is_a_no_op() {
    let registry = AiPromptCancelRegistry::default();
    assert!(!registry.cancel("never-started"));
    assert!(!registry.is_in_flight("never-started"));
}

#[test]
fn cancel_after_the_request_finished_is_a_no_op() {
    let registry = AiPromptCancelRegistry::default();
    let live = registry.register("r1").unwrap();
    let token = live.token();
    drop(live); // the dispatch returned
    assert!(!registry.cancel("r1"));
    assert!(
        !token.is_cancelled(),
        "a finished request's token is never fired late"
    );
}

#[test]
fn dropping_the_guard_removes_the_entry_and_frees_the_id() {
    let registry = AiPromptCancelRegistry::default();
    let live = registry.register("r1").unwrap();
    assert!(registry.is_in_flight("r1"));
    drop(live);
    assert!(!registry.is_in_flight("r1"));
    assert!(registry.register("r1").is_some());
}

#[test]
fn a_duplicate_id_is_refused_and_leaves_the_live_entry_alone() {
    let registry = AiPromptCancelRegistry::default();
    let first = registry.register("r1").unwrap();
    assert!(registry.register("r1").is_none());
    assert!(registry.is_in_flight("r1"));
    assert!(registry.cancel("r1"));
    assert!(
        first.token().is_cancelled(),
        "cancel reached the FIRST registration's token"
    );
}

#[test]
fn entries_are_independent_per_id() {
    let registry = AiPromptCancelRegistry::default();
    let a = registry.register("a").unwrap();
    let b = registry.register("b").unwrap();
    assert!(registry.cancel("a"));
    assert!(a.token().is_cancelled());
    assert!(!b.token().is_cancelled());
    assert!(registry.is_in_flight("b"));
}

// ===== dispatch_registered: the entry lives exactly as long as the dispatch ==

/// Minimal sink: records terminal errors and the done flag.
#[derive(Default)]
struct TerminalSink {
    errors: Mutex<Vec<String>>,
    done: AtomicBool,
}

impl TerminalSink {
    fn errors(&self) -> Vec<String> {
        self.errors.lock().unwrap().clone()
    }
}

impl AiSink for TerminalSink {
    fn chunk(&self, _text: &str) {}
    fn done(&self) {
        self.done.store(true, Ordering::SeqCst);
    }
    fn error(&self, msg: &str) {
        self.errors.lock().unwrap().push(msg.to_owned());
    }
}

fn request<'a>(provider: &'a str, cli_path: Option<String>) -> ProviderRequest<'a> {
    ProviderRequest {
        provider,
        prompt: "ignored",
        model: None,
        api_key: None,
        endpoint: None,
        cli_path,
        max_tokens: None,
    }
}

#[tokio::test]
async fn dispatch_registered_removes_the_entry_when_dispatch_returns_err() {
    // An unknown provider is refused by dispatch before any I/O.
    let registry = AiPromptCancelRegistry::default();
    let sink = Arc::new(TerminalSink::default());
    let result =
        dispatch_registered(&registry, "r1", sink, request("no-such-provider", None)).await;
    assert!(result.is_err());
    assert!(!registry.is_in_flight("r1"));
}

#[tokio::test]
async fn dispatch_registered_removes_the_entry_when_dispatch_ends_via_the_sink() {
    // A REST provider without a key fails through the SINK and returns Ok —
    // the other terminal shape — without touching the network.
    let registry = AiPromptCancelRegistry::default();
    let sink = Arc::new(TerminalSink::default());
    let result =
        dispatch_registered(&registry, "r1", sink.clone(), request("anthropic", None)).await;
    assert_eq!(result, Ok(()));
    assert!(
        !sink.errors().is_empty(),
        "the missing key is reported through the sink"
    );
    assert!(!registry.is_in_flight("r1"));
}

#[tokio::test]
async fn dispatch_registered_refuses_an_id_already_in_flight() {
    let registry = AiPromptCancelRegistry::default();
    let live = registry.register("r1").unwrap();
    let sink = Arc::new(TerminalSink::default());
    let err = dispatch_registered(&registry, "r1", sink, request("anthropic", None))
        .await
        .unwrap_err();
    assert!(err.contains("already in flight"), "{err}");
    assert!(
        registry.is_in_flight("r1"),
        "the refusal must not evict the live request"
    );
    assert!(!live.token().is_cancelled());
}

/// Write an executable `#!/bin/sh` shim into `dir` and return its path — a
/// deterministic CLI stand-in (same fixture shape as collect.test.rs).
#[cfg(unix)]
fn write_shim(dir: &tempfile::TempDir, body: &str) -> String {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let path = dir.path().join("cli-shim");
    let mut f = std::fs::File::create(&path).unwrap();
    write!(f, "#!/bin/sh\n{body}\n").unwrap();
    drop(f);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path.to_str().unwrap().to_owned()
}

/// The property the audit asked for: firing the token from another task
/// kills a CLI provider that would otherwise run for 30 s, the sink sees
/// "Cancelled", and the entry is gone afterwards.
#[cfg(unix)]
#[tokio::test]
async fn cancel_kills_a_running_cli_provider() {
    let dir = tempfile::tempdir().unwrap();
    let shim = write_shim(&dir, "exec sleep 30");
    let registry = Arc::new(AiPromptCancelRegistry::default());
    let sink = Arc::new(TerminalSink::default());

    let canceller = {
        let registry = Arc::clone(&registry);
        tokio::spawn(async move {
            while !registry.is_in_flight("r1") {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            // Give the child a moment to actually be running before the kill.
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(registry.cancel("r1"));
        })
    };

    let started = Instant::now();
    let result =
        dispatch_registered(&registry, "r1", sink.clone(), request("claude", Some(shim))).await;
    canceller.await.unwrap();

    assert_eq!(result, Ok(()), "cancellation is not a provider error");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel must not wait for the 30 s child"
    );
    assert!(
        sink.errors().iter().any(|e| e == "Cancelled"),
        "{:?}",
        sink.errors()
    );
    assert!(!registry.is_in_flight("r1"));
}

// ===== The command, against the managed state ==============================

// `tauri::test` does not exist on Windows (Cargo.toml scopes the feature), so
// the mock-runtime test is gated like every other caller.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn cancel_ai_prompt_command_fires_the_managed_registry() {
    use tauri::Manager;
    let app = tauri::test::mock_builder()
        .manage(AiPromptCancelRegistry::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let registry = app.state::<AiPromptCancelRegistry>();
    let live = registry.register("r1").expect("a fresh id registers");

    cancel_ai_prompt(app.state(), "r1".to_owned())
        .await
        .expect("a live id cancels");
    assert!(live.token().is_cancelled());

    // An id nothing runs under is a successful no-op, not an error.
    cancel_ai_prompt(app.state(), "finished-already".to_owned())
        .await
        .expect("an unknown id is a no-op");
}

// ===== Cancel before registration (#242) ===================================

#[test]
fn a_cancel_that_arrives_before_registration_is_honoured_by_it() {
    // `run_ai_prompt` and `cancel_ai_prompt` are two independently spawned
    // command futures. A cancel that wins the race used to be a successful
    // no-op, and the request then started under a fresh, uncancelled token —
    // the provider ran to completion with nothing able to stop it.
    let registry = AiPromptCancelRegistry::default();
    assert!(!registry.cancel("r1"), "nothing is in flight yet");

    let live = registry
        .register("r1")
        .expect("registration still succeeds");
    assert!(
        live.token().is_cancelled(),
        "the dispatch must start already cancelled"
    );
}

#[test]
fn a_remembered_cancel_is_consumed_by_the_registration_it_was_meant_for() {
    let registry = AiPromptCancelRegistry::default();
    assert!(!registry.cancel("r1"));

    let first = registry.register("r1").expect("registers");
    assert!(first.token().is_cancelled());
    drop(first);

    // Consumed: a later run under the same id is NOT pre-cancelled. Ids are
    // UUIDs so this cannot happen in production, but a latched flag would be
    // a cancel nobody asked for.
    let second = registry.register("r1").expect("registers again");
    assert!(!second.token().is_cancelled());
}

#[test]
fn remembered_cancels_are_bounded_and_forget_the_oldest_first() {
    let registry = AiPromptCancelRegistry::default();
    for i in 0..(PRE_CANCELLED_CAP + 1) {
        assert!(!registry.cancel(&format!("r{i}")));
    }
    // The first id fell off the end; the newest is still remembered.
    assert!(!registry.register("r0").unwrap().token().is_cancelled());
    assert!(registry
        .register(&format!("r{PRE_CANCELLED_CAP}"))
        .unwrap()
        .token()
        .is_cancelled());
}

#[test]
fn a_repeated_cancel_for_an_unknown_id_is_remembered_once() {
    let registry = AiPromptCancelRegistry::default();
    assert!(!registry.cancel("r1"));
    assert!(!registry.cancel("r1"));
    assert!(registry.register("r1").unwrap().token().is_cancelled());
    // One entry, one consumption: the duplicate must not linger and cancel a
    // later registration under the same id.
    assert!(!registry.register("r1").unwrap().token().is_cancelled());
}

/// The guard's claim for a dispatch that is DROPPED mid-flight (#244).
///
/// `dropping_the_guard_removes_the_entry_and_frees_the_id` drops the guard
/// directly; this drops the whole command future while the dispatch is still
/// awaiting a running child, which is the shape the header actually promises
/// ("on `Ok`, on `Err`, and when the command future is dropped mid-flight").
/// The guard lives in that future's frame, so only aborting the task proves
/// its `Drop` runs there.
#[cfg(unix)]
#[tokio::test]
async fn aborting_a_dispatch_mid_flight_removes_the_entry_and_frees_the_id() {
    let dir = tempfile::tempdir().unwrap();
    let shim = write_shim(&dir, "exec sleep 30");
    let registry = Arc::new(AiPromptCancelRegistry::default());
    let sink = Arc::new(TerminalSink::default());

    let task = {
        let registry = Arc::clone(&registry);
        let sink = Arc::clone(&sink);
        tokio::spawn(async move {
            let _ = dispatch_registered(&registry, "r1", sink, request("claude", Some(shim))).await;
        })
    };

    // Wait until the dispatch is genuinely registered, then kill the task.
    let started = Instant::now();
    while !registry.is_in_flight("r1") {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "never registered"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());

    assert!(
        !registry.is_in_flight("r1"),
        "the guard's Drop must run during the abort's unwind"
    );
    assert!(
        registry.register("r1").is_some(),
        "and the id is reusable afterwards"
    );
}
