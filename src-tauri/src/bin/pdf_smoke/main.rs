//! WI-PDF2.1/3.1 — real-wry smoke test for the native PDF renderers.
//!
//! Purpose: prove the shipped renderer produces a correct PDF on a real
//! platform webview. `cargo test` cannot host this. Tauri's `test` feature is
//! excluded on Windows in this crate because MockRuntime dies with
//! `STATUS_ENTRYPOINT_NOT_FOUND`, and MockRuntime runs "main-thread" work
//! inline with `with_webview` as a no-op — so it would prove nothing even
//! where it links. Only a genuine event loop exercises the code that ships.
//!
//! Run:
//!   cargo run --bin pdf_smoke --features pdf-smoke -- <out-dir>
//!
//! Or, for visual QA on a real document rather than the fixtures:
//!   cargo run --bin pdf_smoke --features pdf-smoke -- --html <file> <out-dir>
//! See `render_one.rs` — that mode asserts the same geometry, but its point is
//! an artifact a human can look at.
//!
//! It exits non-zero on the first failure and prints one `SMOKE ...` line per
//! case, so a caller can assert on the transcript rather than on a exit code
//! alone.
//!
//! Cases, and why each exists — the bodies live in `scenarios.rs`:
//!
//! - `geometry_matrix` — all four paper sizes × both orientations. Is
//!   `PageSpec` honoured, or is the platform default silently used? A valid
//!   `%PDF` at the wrong size is the failure a magic-byte assertion cannot see
//!   (ADR-PDF1), and orientation is a width/height swap rather than a flag
//!   (ADR-PDF1a).
//! - `pagination` — `basic` (does it produce a PDF at all), `a5` (the one size
//!   the matrix does not carry), and `large`: a document over 2 MiB, since
//!   wry's `.with_html` caps there and VMark inlines images as data URIs. That
//!   one asserts a SENTINEL past the boundary, because truncation still yields
//!   a valid A4 PDF.
//! - `page_numbers_case` — the stamp survives each engine's own page tree.
//! - `badpath` — an unwritable destination must be refused UP FRONT. On macOS
//!   an NSPrintOperation pointed at a missing directory does not fail, it
//!   spools to the default printer; an earlier version of this harness put
//!   four blank pages through a real one.
//! - `sequential` — 20 exports in a row leak no window.
//! - `concurrent` — 2 at once collide on neither a window label nor each
//!   other's output, checked by distinct content sentinels.
//!
//! @coordinates-with pdf_export/renderer — the code under test
//! @module bin/pdf_smoke

use std::path::Path;
use std::time::Duration;

use vmark_lib::pdf_export::page_spec::PageSpec;

fn main() {
    // `--html <file> <out-dir>` renders a supplied document — see render_one.rs.
    // Refuse a malformed invocation rather than silently running the fixture
    // matrix instead of the document the caller named.
    let (one_shot, out_dir) = match render_one::parse_args(std::env::args().collect()) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("pdf_smoke: {e}");
            eprintln!("usage: pdf_smoke [--html <file>] <out-dir>");
            std::process::exit(2);
        }
    };
    std::fs::create_dir_all(&out_dir).expect("create out dir");

    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("build tauri app");

    let handle = app.handle().clone();
    let out = out_dir.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let failures = match one_shot {
            Some(html) => rt.block_on(render_one::run(&handle, &html, &out)),
            None => rt.block_on(run_cases(&handle, &out)),
        };
        // Give the loop a moment to drain window closes before exiting, so a
        // leak check sees the steady state rather than teardown in flight.
        std::thread::sleep(Duration::from_millis(500));
        println!("SMOKE done failures={failures}");
        std::process::exit(if failures == 0 { 0 } else { 1 });
    });

    app.run(|_, _| {});
}

/// Run every scenario, in order, and return the total failure count.
///
/// A flat list on purpose: each scenario owns its own counter, so one cannot
/// report on another's work. That is not tidiness — the shared counter this
/// replaced let the sequential case print "PASS 20 exports" for a run that had
/// broken out after the first failure.
async fn run_cases(app: &tauri::AppHandle, out: &Path) -> usize {
    let mut failures = 0usize;
    failures += scenarios::geometry_matrix(app, out).await;
    failures += scenarios::pagination(app, out).await;
    failures += page_numbers_case::run(app, out).await;
    failures += scenarios::bad_path(app).await;
    failures += scenarios::sequential(app, out).await;
    failures += scenarios::concurrent(app, out).await;
    failures
}

async fn render(
    app: &tauri::AppHandle,
    html: &str,
    out: &Path,
    page: PageSpec,
) -> Result<(), String> {
    vmark_lib::pdf_export::renderer::render_pdf(
        app.clone(),
        html.to_string(),
        out.to_string_lossy().to_string(),
        page,
    )
    .await
    .map_err(|e| format!("{:?}: {}", e.code(), e.message()))
}

mod fixtures;
mod html_text;
mod page_number_fixture;
mod page_numbers_case;
mod render_one;
mod scenarios;
mod verify;
