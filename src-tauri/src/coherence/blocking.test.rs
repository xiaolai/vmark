// WI-RA11.4 — a coherence command's kernel work runs on the blocking pool:
// never on the async worker that received the IPC call, and with the kernel
// lock taken and released entirely inside that blocking task.

use super::*;
use std::path::PathBuf;

/// Every non-test source file of the coherence module.
fn coherence_sources() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/coherence");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            name.ends_with(".rs") && !name.ends_with(".test.rs")
        })
        .collect();
    files.sort();
    files
}

/// The text of each `#[tauri::command]` function in `source`: from the
/// attribute to the brace that closes the body. Only an attribute that opens
/// its line counts — the same text inside a doc comment is prose.
fn command_bodies(source: &str) -> Vec<String> {
    const ATTRIBUTE: &str = "#[tauri::command]";
    let mut bodies = Vec::new();
    let mut rest = source;
    while let Some(start) = rest.find(ATTRIBUTE) {
        let line_start = rest[..start].rfind('\n').map_or(0, |i| i + 1);
        if !rest[line_start..start].trim().is_empty() {
            rest = &rest[start + ATTRIBUTE.len()..];
            continue;
        }
        let from = &rest[start..];
        let open = from.find('{').expect("a command has a body");
        let mut depth = 0usize;
        let mut end = from.len();
        for (i, ch) in from[open..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = open + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        bodies.push(from[..end].to_string());
        rest = &from[end..];
    }
    bodies
}

/// The class this module exists to close: a coherence command that opens or
/// locks a kernel in its own body does that disk work on the async worker.
/// Every command must route its kernel work through `with_kernel` or
/// `on_blocking_pool`.
#[test]
fn no_coherence_command_touches_a_kernel_on_the_async_worker() {
    let mut commands = 0;
    let mut offenders = Vec::new();
    for file in coherence_sources() {
        let source = std::fs::read_to_string(&file).unwrap();
        for body in command_bodies(&source) {
            commands += 1;
            let name = body
                .split("fn ")
                .nth(1)
                .and_then(|s| s.split(['(', '<']).next())
                .unwrap_or("?")
                .to_string();
            let routed = body.contains("with_kernel(") || body.contains("on_blocking_pool(");
            let inline = body.contains(".kernel_for(") || body.contains(".lock()");
            if !routed || inline {
                offenders.push(format!(
                    "{}::{name}",
                    file.file_name().unwrap().to_string_lossy()
                ));
            }
        }
    }
    // The floor is the real command count, so a scanner that silently stops
    // seeing commands fails here. Deleting a command lowers it by one.
    assert!(commands >= 25, "found only {commands} coherence commands");
    assert!(
        offenders.is_empty(),
        "commands doing kernel work on the async worker: {offenders:?}"
    );
}

#[test]
fn the_command_scanner_sees_a_body_that_opens_a_kernel_inline() {
    let source = r#"
//! The `#[tauri::command]` wrappers live here.
#[tauri::command]
pub async fn inline(state: State<'_, CoherenceState>) -> Result<(), CommandError> {
    let kernel = state.registry.kernel_for(root, state.writer)?;
    let _k = kernel.lock();
    Ok(format!("{x}"))
}

fn not_a_command() { let _ = 1; }

#[tauri::command]
pub async fn routed(app: AppHandle) -> Result<(), CommandError> {
    with_kernel(app, root, |_, k| { Ok(()) }).await
}
"#;
    let bodies = command_bodies(source);
    assert_eq!(bodies.len(), 2);
    assert!(bodies[0].contains(".kernel_for(") && !bodies[0].contains("not_a_command"));
    assert!(bodies[1].contains("with_kernel("));
}

// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it), so these are gated like every mock-runtime suite.
#[cfg(not(target_os = "windows"))]
mod on_a_mock_app {
    use super::super::*;
    use crate::coherence::state::KernelRegistry;
    use crate::coherence::types::WriterId;
    use crate::command_error::ErrorCode;
    use std::sync::atomic::AtomicBool;

    fn app_with_coherence() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(CoherenceState {
                registry: KernelRegistry::default(),
                writer: WriterId(uuid::Uuid::from_u128(11)),
                sweep_in_flight: AtomicBool::new(false),
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    /// One worker thread: anything the command does inline runs on THIS thread.
    fn single_worker() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn kernel_work_runs_off_the_thread_that_awaits_it() {
        let app = app_with_coherence();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let caller = std::thread::current().id();

        let (worker, kernel_root) = single_worker()
            .block_on(with_kernel(app.handle().clone(), root, |_, kernel| {
                Ok((std::thread::current().id(), kernel.root().to_path_buf()))
            }))
            .expect("kernel work succeeds");

        assert_ne!(
            worker, caller,
            "kernel I/O must not run on the async worker"
        );
        assert_eq!(kernel_root, dir.path().canonicalize().unwrap());
    }

    #[test]
    fn a_missing_workspace_is_reported_not_panicked() {
        let app = app_with_coherence();
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("no-such-workspace");

        let error = single_worker()
            .block_on(with_kernel(
                app.handle().clone(),
                missing.to_string_lossy().to_string(),
                |_, _| Ok(()),
            ))
            .expect_err("the root does not exist");

        assert_eq!(error.code(), ErrorCode::Internal);
    }

    #[test]
    fn an_app_without_coherence_state_gets_an_error_not_a_panic() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let dir = tempfile::tempdir().unwrap();

        let error = single_worker()
            .block_on(with_kernel(
                app.handle().clone(),
                dir.path().to_string_lossy().to_string(),
                |_, _| Ok(()),
            ))
            .expect_err("no coherence state is managed");

        assert_eq!(error.code(), ErrorCode::Internal);
    }

    #[test]
    fn the_kernel_lock_is_free_again_when_the_work_returns() {
        let app = app_with_coherence();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        single_worker()
            .block_on(with_kernel(app.handle().clone(), root, |_, _| Ok(())))
            .unwrap();

        let state = app.handle().state::<CoherenceState>();
        let kernel = state.registry.kernel_for(dir.path(), state.writer).unwrap();
        assert!(
            kernel.try_lock().is_ok(),
            "no guard may outlive the blocking task"
        );
    }

    #[test]
    fn a_panic_in_the_work_is_an_internal_error() {
        let app = app_with_coherence();
        let dir = tempfile::tempdir().unwrap();

        let error = single_worker()
            .block_on(with_kernel::<_, (), _>(
                app.handle().clone(),
                dir.path().to_string_lossy().to_string(),
                |_, _| panic!("kernel work failed"),
            ))
            .expect_err("a panicking task is an error");

        assert_eq!(error.code(), ErrorCode::Internal);
    }
}
