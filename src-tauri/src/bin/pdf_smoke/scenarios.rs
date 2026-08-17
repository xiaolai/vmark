//! The individual smoke scenarios.
//!
//! Purpose: `run_cases` had grown into a ~190-line coordinator holding geometry,
//! pagination, bad-path, sequential and concurrency flows in one scope with one
//! shared `failures` counter. That is not only long — its mixed state produced a
//! FALSE transcript: the sequential case incremented `failures` and `break`ed on
//! a render error, then fell through to the window-leak check, which printed
//! "PASS 20 exports" for a run where fewer than 20 had rendered.
//!
//! Each scenario now owns its own counter and returns it, so a scenario cannot
//! report on work another one did or did not do.
//!
//! @coordinates-with main.rs — the coordinator that calls these
//! @coordinates-with verify.rs — every assertion lands there
//! @module bin/pdf_smoke/scenarios

use std::path::Path;
use std::time::Duration;

use tauri::Manager;
use vmark_lib::pdf_export::page_spec::PageSpec;

use super::fixtures::{doc_for, large_doc};
use super::render;
use super::verify::{check, contains_text};

/// A4 and A5 in points, portrait.
const A4: PageSpec = PageSpec::new(595.28, 841.89);
const A5: PageSpec = PageSpec::new(419.53, 595.28);

/// Every size × orientation the dialog offers.
///
/// Until WI-PDF1.4 every one of them produced the system default paper on
/// macOS, so this asserts the whole surface rather than a sample. Points are the
/// portrait dimensions; landscape is the swap, never a flag (ADR-PDF1a).
pub async fn geometry_matrix(app: &tauri::AppHandle, out: &Path) -> usize {
    const SIZES: [(&str, f64, f64); 4] = [
        ("A4", 595.28, 841.89),
        ("letter", 612.0, 792.0),
        ("A3", 841.89, 1190.55),
        ("legal", 612.0, 1008.0),
    ];
    let mut failures = 0usize;
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
    failures
}

/// Cases the geometry matrix does not already cover.
///
/// It used to also carry standalone `legal` and `landscape` cases. Both were
/// redundant — the matrix renders legal portrait/landscape and A4 landscape with
/// the same assertions — and the `legal` one reused the matrix's transcript
/// name, so `SMOKE legal PASS` appeared twice per run with different byte
/// counts and no way to tell which had failed. A5 is NOT in the matrix, so it
/// stays.
pub async fn pagination(app: &tauri::AppHandle, out: &Path) -> usize {
    let mut failures = 0usize;

    let basic = out.join("basic.pdf");
    failures += check(
        "basic",
        render(
            app,
            &doc_for("A4", "<div class='b'>one</div><div class='b'>two</div>"),
            &basic,
            A4,
        )
        .await,
        &basic,
        Some((595, 842)),
    );

    let a5 = out.join("a5.pdf");
    failures += check(
        "a5",
        render(app, &doc_for("A5", "<p>a5</p>"), &a5, A5).await,
        &a5,
        // The whole point: a backend ignoring PageSpec still emits a valid PDF,
        // just at the platform default.
        Some((420, 595)),
    );

    // Over 2 MiB — wry's `.with_html` caps there, so this proves navigation is
    // used (ADR-PDF4). The SENTINEL is the actual assertion: truncation at the
    // boundary still yields a valid A4 PDF, so a geometry check alone would pass
    // on exactly the failure this case exists to catch. The fixture has always
    // carried the marker; nothing looked for it.
    let large = out.join("large.pdf");
    let rendered = render(app, &large_doc("A4"), &large, A4).await;
    let ok = rendered.is_ok();
    failures += check("large", rendered, &large, Some((595, 842)));
    if ok {
        failures += contains_text("large", &large, "SENTINEL-PAST-2MIB");
    }

    failures
}

/// A bad output path must be REFUSED before any print operation starts.
///
/// This case is why the renderer validates the path itself. On macOS an
/// NSPrintOperation pointed at a nonexistent directory does not fail — it spools
/// the document to the DEFAULT PRINTER. An earlier version of this harness put
/// four blank pages through a real one.
pub async fn bad_path(app: &tauri::AppHandle) -> usize {
    // ABSOLUTE-but-missing, and a POSIX literal is not absolute on Windows: a
    // leading separator with no drive letter is root-RELATIVE, so validation
    // refused it at the is_absolute check and returned InvalidInput, never
    // reaching the missing-directory guard. `commands.test.rs` had already hit
    // and documented that trap; this is its temp_dir answer.
    //
    // The directory name is UNIQUE per process: a fixed name under the shared
    // temp dir can be left behind by an earlier run or created by a concurrent
    // one, and then the case silently exercises a VALID destination and passes
    // for the wrong reason.
    let dir = std::env::temp_dir().join(format!("vmark-no-such-dir-{}", std::process::id()));
    if dir.exists() {
        println!("SMOKE badpath FAIL scratch dir {dir:?} already exists");
        return 1;
    }
    let path = dir.join("x.pdf");

    match vmark_lib::pdf_export::renderer::render_pdf(
        app.clone(),
        String::new(),
        path.to_string_lossy().into_owned(),
        A4,
    )
    .await
    {
        Err(e) if e.code() == vmark_lib::command_error::ErrorCode::NotFound => {
            println!("SMOKE badpath PASS refused up front, code=NotFound");
            0
        }
        Err(e) => {
            // Refused, but not by the guard — a timeout here means the print
            // operation STARTED, which is the dangerous path.
            println!("SMOKE badpath FAIL refused late, code={:?}", e.code());
            1
        }
        Ok(()) => {
            println!("SMOKE badpath FAIL accepted an impossible path");
            1
        }
    }
}

/// 20 exports in a row leak no window.
pub async fn sequential(app: &tauri::AppHandle, out: &Path) -> usize {
    let before = app.webview_windows().len();
    let mut completed = 0usize;
    let mut failures = 0usize;
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
        completed += 1;
    }

    // The renderer settles the sink and THEN closes its window, so the caller
    // resumes before the close has been processed — counting immediately
    // measures a close in flight, not a leak. The contract is that windows
    // return to baseline promptly, so poll for that with a bound: if they never
    // do, it is a real leak and this still fails.
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
    } else if completed == 20 {
        println!("SMOKE sequential PASS 20 exports, windows {before} -> {after}");
    } else {
        // Reporting "PASS 20 exports" here is what the old shared-counter
        // version did after breaking out early.
        println!("SMOKE sequential FAIL only {completed}/20 exports rendered");
    }
    failures
}

/// Two at once must not collide on a window label — or on each other's output.
pub async fn concurrent(app: &tauri::AppHandle, out: &Path) -> usize {
    // The docs and paths are bound first: `tokio::join!` borrows across an await
    // point, so temporaries created inside it do not live long enough.
    let (d1, d2) = (doc_for("A4", "<p>c1</p>"), doc_for("A4", "<p>c2</p>"));
    let (p1, p2) = (out.join("con-1.pdf"), out.join("con-2.pdf"));
    let (a, b) = tokio::join!(render(app, &d1, &p1, A4), render(app, &d2, &p2, A4),);

    let mut failures = 0usize;
    let (ok1, ok2) = (a.is_ok(), b.is_ok());
    failures += check("concurrent-1", a, &p1, Some((595, 842)));
    failures += check("concurrent-2", b, &p2, Some((595, 842)));
    // Two `Ok`s were the whole assertion before. They cannot see the failure
    // this case is named for: a shared window label or a crossed output path
    // makes both renders succeed while one document overwrites the other, and
    // both files are valid A4 PDFs afterwards. The distinct sentinels can.
    if ok1 {
        failures += contains_text("concurrent-1", &p1, "c1");
    }
    if ok2 {
        failures += contains_text("concurrent-2", &p2, "c2");
    }
    failures
}
