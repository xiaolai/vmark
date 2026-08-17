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
//! Cases, and why each exists:
//!
//! - `basic` — does it produce a PDF at all.
//! - `legal` / `a5` — is `PageSpec` honoured, or is the platform default
//!   silently used? A valid `%PDF` at the wrong size is the failure a
//!   magic-byte assertion cannot see (ADR-PDF1).
//! - `landscape` — orientation, which is a width/height swap rather than a
//!   flag (ADR-PDF1a).
//! - `large` — a document over 2 MiB. wry's `.with_html` caps there, so this
//!   proves navigation is used (ADR-PDF4); VMark inlines images as data URIs,
//!   so real exports routinely exceed it.
//! - `badpath` — an unwritable destination must be refused UP FRONT. On macOS
//!   an NSPrintOperation pointed at a missing directory does not fail, it
//!   spools to the default printer; an earlier version of this harness put
//!   four blank pages through a real one.
//! - `sequential` — 20 exports in a row leak no window.
//! - `concurrent` — 2 at once do not collide on a window label.
//!
//! @coordinates-with pdf_export/renderer — the code under test
//! @module bin/pdf_smoke

use std::path::Path;

use std::time::Duration;
use tauri::Manager;

use vmark_lib::pdf_export::page_spec::PageSpec;

/// A4 and A5 in points, portrait.
const A4: PageSpec = PageSpec::new(595.28, 841.89);
const A5: PageSpec = PageSpec::new(419.53, 595.28);
const A4_LANDSCAPE: PageSpec = PageSpec::new(841.89, 595.28);

fn main() {
    // `--html <file> <out-dir>` renders a supplied document — see render_one.rs.
    let (one_shot, out_dir) = render_one::parse_args(std::env::args().collect());
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

async fn run_cases(app: &tauri::AppHandle, out: &Path) -> usize {
    let mut failures = 0usize;

    // All eight UI combinations. The dialog offers four sizes and two
    // orientations, and until WI-PDF1.4 every one of them produced the system
    // default paper on macOS — so this asserts the whole surface, not a
    // sample. Points are the portrait dimensions; landscape is the swap.
    const SIZES: [(&str, f64, f64); 4] = [
        ("A4", 595.28, 841.89),
        ("letter", 612.0, 792.0),
        ("A3", 841.89, 1190.55),
        ("legal", 612.0, 1008.0),
    ];
    for (css, w, h) in SIZES {
        for landscape in [false, true] {
            let spec = if landscape {
                PageSpec::new(h, w)
            } else {
                PageSpec::new(w, h)
            };
            let name = format!("{css}{}", if landscape { "-landscape" } else { "" });
            let css_size = if landscape {
                format!("{css} landscape")
            } else {
                css.to_string()
            };
            let path = out.join(format!("matrix-{name}.pdf"));
            failures += check(
                &name,
                render(app, &doc_for(&css_size, "<p>matrix</p>"), &path, spec).await,
                &path,
                Some((spec.width_pt.round() as u32, spec.height_pt.round() as u32)),
            );
        }
    }

    failures += check(
        "basic",
        render(
            app,
            &doc_for("A4", "<div class='b'>one</div><div class='b'>two</div>"),
            &out.join("basic.pdf"),
            A4,
        )
        .await,
        &out.join("basic.pdf"),
        Some((595, 842)),
    );

    // Legal is 612x1008 — nothing like A4, so "the default came out" cannot be
    // mistaken for "the request was honoured".
    const LEGAL: PageSpec = PageSpec::new(612.0, 1008.0);
    failures += check(
        "legal",
        render(
            app,
            &doc_for("legal", "<p>legal</p>"),
            &out.join("legal.pdf"),
            LEGAL,
        )
        .await,
        &out.join("legal.pdf"),
        Some((612, 1008)),
    );

    failures += check(
        "a5",
        render(app, &doc_for("A5", "<p>a5</p>"), &out.join("a5.pdf"), A5).await,
        &out.join("a5.pdf"),
        // The whole point: a backend ignoring PageSpec still emits a valid
        // PDF, just at the platform default.
        Some((420, 595)),
    );

    failures += check(
        "landscape",
        render(
            app,
            &doc_for("A4 landscape", "<p>wide</p>"),
            &out.join("landscape.pdf"),
            A4_LANDSCAPE,
        )
        .await,
        &out.join("landscape.pdf"),
        Some((842, 595)),
    );

    failures += check(
        "large",
        render(app, &large_doc("A4"), &out.join("large.pdf"), A4).await,
        &out.join("large.pdf"),
        Some((595, 842)),
    );

    failures += page_numbers_case::run(app, out).await;

    // A bad output path must be REFUSED before any print operation starts.
    //
    // This case is why the renderer validates the path itself. On macOS an
    // NSPrintOperation pointed at a nonexistent directory does not fail — it
    // spools the document to the DEFAULT PRINTER. An earlier version of this
    // harness put four blank pages through a real one. The assertion is now
    // that the refusal happens up front, with a code that says so.
    //
    // The path must be ABSOLUTE-but-missing, and a POSIX literal is not
    // absolute on Windows: a leading separator with no drive letter is
    // root-RELATIVE, so `validate_output_path` refused it at the is_absolute
    // check and returned InvalidInput, never reaching the missing-directory
    // guard this case exists to exercise. The harness reported a Windows-only
    // failure for a fixture bug — the noise that gets a cross-platform job
    // ignored. `commands.test.rs` had already hit and documented this exact
    // trap; deriving from `temp_dir()` is its answer, so use the same one
    // rather than a second idiom that can drift.
    let missing_dir_pdf = std::env::temp_dir()
        .join("vmark-definitely-not-here")
        .join("x.pdf")
        .to_string_lossy()
        .into_owned();
    match vmark_lib::pdf_export::renderer::render_pdf(
        app.clone(),
        String::new(),
        missing_dir_pdf,
        A4,
    )
    .await
    {
        Err(e) if e.code() == vmark_lib::command_error::ErrorCode::NotFound => {
            println!("SMOKE badpath PASS refused up front, code=NotFound")
        }
        Err(e) => {
            // Refused, but not by the guard — a timeout here means the print
            // operation STARTED, which is the dangerous path.
            println!("SMOKE badpath FAIL refused late, code={:?}", e.code());
            failures += 1;
        }
        Ok(()) => {
            println!("SMOKE badpath FAIL accepted an impossible path");
            failures += 1;
        }
    }

    // 20 in a row: a leaked render window would accumulate here.
    let before = app.webview_windows().len();
    for i in 0..20 {
        let p = out.join(format!("seq-{i}.pdf"));
        if render(app, &doc_for("A4", "<p>seq</p>"), &p, A4)
            .await
            .is_err()
        {
            println!("SMOKE sequential FAIL at {i}");
            failures += 1;
            break;
        }
    }
    // The renderer settles the sink and THEN closes its window, so the caller
    // resumes before the close has been processed — counting immediately
    // measures a close in flight, not a leak. The contract is that windows
    // return to baseline promptly, so poll for that with a bound: if they
    // never do, it is a real leak and this still fails.
    let mut after = app.webview_windows().len();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while after > before && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
        after = app.webview_windows().len();
    }
    if after > before {
        println!(
            "SMOKE sequential FAIL leaked {} window(s) after 10s",
            after - before
        );
        failures += 1;
    } else {
        println!("SMOKE sequential PASS 20 exports, windows {before} -> {after}");
    }

    // Two at once must not collide on a window label. The docs and paths are
    // bound first: `tokio::join!` borrows across an await point, so temporaries
    // created inside it do not live long enough.
    let (d1, d2) = (doc_for("A4", "<p>c1</p>"), doc_for("A4", "<p>c2</p>"));
    let (p1, p2) = (out.join("con-1.pdf"), out.join("con-2.pdf"));
    let (a, b) = tokio::join!(render(app, &d1, &p1, A4), render(app, &d2, &p2, A4),);
    if a.is_ok() && b.is_ok() {
        println!("SMOKE concurrent PASS");
    } else {
        println!("SMOKE concurrent FAIL a={a:?} b={b:?}");
        failures += 1;
    }

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
mod page_numbers_case;
mod render_one;
mod verify;
use fixtures::{doc_for, large_doc};
use verify::check;
