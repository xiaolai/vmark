//! WI-FL6.2 — the progress stages are emitted on THIS platform's real backend.
//!
//! Purpose: `progress.test.rs` pins the sequence under each platform's
//! callback shape, but only against a capturing sink — nothing in `cargo
//! test` runs a native webview. This case captures the shipped emission
//! (`app.emit_to` the export window) through `listen_any`, which Tauri's
//! listener registry delivers for any target, and asserts the sequence the
//! dialog would have seen. Until WI-FL6.2 Windows and Linux would have
//! produced an empty list here.
//!
//! Three assertions, because each fails for a different reason:
//!   - a RENDER emits `loading → rendering → finishing`, in order, once each;
//!   - the COMMAND (`export_pdf`) adds `done` after post-processing — that is
//!     the one stage the renderer must NOT emit, or the dialog says "Done"
//!     while the outline is still being written;
//!   - a path refused up front — by the guard, with `NotFound` — emits
//!     nothing: no stage may leak from a render that never started.
//!
//! A payload the dialog could not parse counts as a failure of the case it
//! arrived in (#109): the dialog would show the raw key, and dropping it from
//! the captured list would let the sequence still read correct.
//!
//! @coordinates-with main.rs — the coordinator that calls this
//! @coordinates-with pdf_export/renderer/progress.rs — the vocabulary and the event
//! @module bin/pdf_smoke/progress_case

use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::Listener;
use vmark_lib::pdf_export::renderer::progress::{PdfProgress, PdfProgressEvent, PROGRESS_EVENT};

use super::fixtures::{doc_for, A4};
use super::missing_path::{missing_parent, refusal_verdict};

/// Everything the listener saw between `start` and `stop`, in delivery order.
#[derive(Default, Clone)]
struct Captured {
    stages: Vec<PdfProgress>,
    /// Raw payloads that did not parse as a `PdfProgressEvent`.
    malformed: Vec<String>,
}

struct Capture {
    seen: Arc<Mutex<Captured>>,
    id: tauri::EventId,
}

impl Capture {
    fn start(app: &tauri::AppHandle) -> Self {
        let seen = Arc::new(Mutex::new(Captured::default()));
        let sink = seen.clone();
        // `listen_any`, not `listen`: the renderer emits TO the export window
        // (`emit_to`), and a plain `listen` on the app handle is filtered to
        // the app target. Rust listeners run inside the emit, so by the time
        // the render future resolves every stage it emitted is recorded.
        let id = app.listen_any(PROGRESS_EVENT, move |event| {
            let mut seen = sink.lock().expect("capture lock");
            match serde_json::from_str::<PdfProgressEvent>(event.payload()) {
                Ok(e) => seen.stages.push(e.stage),
                Err(_) => seen.malformed.push(event.payload().to_string()),
            }
        });
        Self { seen, id }
    }

    fn stop(self, app: &tauri::AppHandle) -> Captured {
        app.unlisten(self.id);
        self.seen.lock().expect("capture lock").clone()
    }
}

/// Run `op` with a capture around it and return both (#110). The operation is
/// a future, so nothing runs before the listener is registered.
async fn captured<T>(app: &tauri::AppHandle, op: impl Future<Output = T>) -> (T, Captured) {
    let capture = Capture::start(app);
    let result = op.await;
    (result, capture.stop(app))
}

/// One failure for a malformed payload, whatever else the case found.
fn check_parsed(name: &str, seen: &Captured) -> usize {
    if seen.malformed.is_empty() {
        return 0;
    }
    println!(
        "SMOKE {name} FAIL {} unparseable progress payload(s): {:?}",
        seen.malformed.len(),
        seen.malformed
    );
    1
}

fn check_sequence(
    name: &str,
    result: Result<(), String>,
    seen: &Captured,
    expected: &[PdfProgress],
) -> usize {
    let mut failures = check_parsed(name, seen);
    if let Err(e) = result {
        println!("SMOKE {name} FAIL render error: {e}");
        return failures + 1;
    }
    if seen.stages == expected {
        if failures == 0 {
            println!("SMOKE {name} PASS stages {}", names(&seen.stages));
        }
    } else {
        println!(
            "SMOKE {name} FAIL stages {}, expected {}",
            names(&seen.stages),
            names(expected)
        );
        failures += 1;
    }
    failures
}

fn names(stages: &[PdfProgress]) -> String {
    let list: Vec<&str> = stages.iter().map(|s| s.as_str()).collect();
    format!("[{}]", list.join(" → "))
}

/// Returns the failure count.
pub async fn run(app: &tauri::AppHandle, out: &Path) -> usize {
    let mut failures = 0usize;

    // A render: the three renderer stages, and only those.
    let path = out.join("progress-render.pdf");
    let (result, seen) = captured(
        app,
        super::render(app, &doc_for("A4", "<p>progress</p>"), &path, A4),
    )
    .await;
    failures += check_sequence("progress-render", result, &seen, &PdfProgress::RENDER);

    // The command: the same three, then `done` after post-processing. The
    // command is called directly — it is an ordinary async fn under the
    // `#[tauri::command]` attribute — with no outline or page numbers, so
    // post-processing is a no-op and `done` still has to come from the
    // command layer, not the renderer.
    let path = out.join("progress-command.pdf");
    let (result, seen) = captured(
        app,
        vmark_lib::pdf_export::commands::export_pdf(
            app.clone(),
            doc_for("A4", "<p>progress command</p>"),
            path.to_string_lossy().into_owned(),
            None,
            A4,
            None,
        ),
    )
    .await;
    let result = result
        .map(|_| ())
        .map_err(|e| format!("{:?}: {}", e.code(), e.message()));
    failures += check_sequence("progress-command", result, &seen, &PdfProgress::ALL);

    failures + refused(app).await
}

/// A refused path: validation happens before any stage, so nothing leaks.
///
/// The fixture and the refusal rule are `missing_path`'s, shared with
/// `scenarios::bad_path` (#111, audit 20260907 #251/#253) — the same
/// destination and the same "must be `NotFound`, from the guard" verdict. What
/// stays here is the assertion this case is FOR: that nothing was emitted.
async fn refused(app: &tauri::AppHandle) -> usize {
    let fixture = match missing_parent() {
        Ok(fixture) => fixture,
        Err(e) => {
            println!("SMOKE progress-refused FAIL could not build the fixture: {e}");
            return 1;
        }
    };
    let (result, seen) = captured(
        app,
        vmark_lib::pdf_export::renderer::render_pdf(
            app.clone(),
            String::new(),
            fixture.path.to_string_lossy().into_owned(),
            A4,
        ),
    )
    .await;
    let mut failures = check_parsed("progress-refused", &seen);
    // TWO independent conditions, reported independently (audit 20260907 #254).
    // Folding them into one match arm meant a correct `NotFound` that had
    // nonetheless leaked stages fell through to the arm that prints
    // "code=NotFound (expected NotFound)" — a line that reads as a
    // contradiction and names the one thing that was right. The leak is the
    // failure this case exists to catch, so it gets its own sentence.
    let refusal = refusal_verdict(result);
    let leaked = !seen.stages.is_empty();
    if let Err(why) = &refusal {
        println!(
            "SMOKE progress-refused FAIL {why}, stages {}",
            names(&seen.stages)
        );
        failures += 1;
    }
    if leaked {
        println!(
            "SMOKE progress-refused FAIL a render that never started emitted stages {}",
            names(&seen.stages)
        );
        failures += 1;
    }
    if failures == 0 {
        println!("SMOKE progress-refused PASS no stages from a render that never started");
    }
    failures
}
