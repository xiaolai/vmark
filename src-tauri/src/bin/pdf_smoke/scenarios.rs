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

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use tauri::Manager;
use vmark_lib::pdf_export::page_spec::PageSpec;

use super::fixtures::{doc_for, expected_pt, large_doc, A3, A4, A5, LEGAL, LETTER};
use super::missing_path::{missing_parent, refusal_verdict};
use super::render;
use super::verify::{check, contains_text, lacks_text, pages_at_least};

/// Every size × orientation the dialog offers.
///
/// Until WI-PDF1.4 every one of them produced the system default paper on
/// macOS, so this asserts the whole surface rather than a sample. The sizes
/// are the fixtures' (#108); landscape is the swap, never a flag (ADR-PDF1a).
pub async fn geometry_matrix(app: &tauri::AppHandle, out: &Path) -> usize {
    const SIZES: [(&str, PageSpec); 4] =
        [("A4", A4), ("letter", LETTER), ("A3", A3), ("legal", LEGAL)];
    let mut failures = 0usize;
    for (css, portrait) in SIZES {
        for landscape in [false, true] {
            let spec = if landscape {
                PageSpec::new(portrait.height_pt, portrait.width_pt)
            } else {
                portrait
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
                expected_pt(spec),
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
    let rendered = render(
        app,
        &doc_for("A4", "<div class='b'>one</div><div class='b'>two</div>"),
        &basic,
        A4,
    )
    .await;
    let ok = rendered.is_ok();
    failures += check("basic", rendered, &basic, expected_pt(A4));
    // The fixture is 360 mm of content on a 297 mm page, so it MUST paginate.
    // Nothing checked that: `check` prints an approximate page count and
    // asserts only the header and the first MediaBox, so a renderer that
    // clipped everything past page one passed the case named for pagination.
    if ok {
        failures += pages_at_least("basic", &basic, 2);
    }

    let a5 = out.join("a5.pdf");
    failures += check(
        "a5",
        render(app, &doc_for("A5", "<p>a5</p>"), &a5, A5).await,
        &a5,
        // The whole point: a backend ignoring PageSpec still emits a valid PDF,
        // just at the platform default.
        expected_pt(A5),
    );

    // Over 2 MiB — wry's `.with_html` caps there, so this proves navigation is
    // used (ADR-PDF4). The SENTINEL is the actual assertion: truncation at the
    // boundary still yields a valid A4 PDF, so a geometry check alone would pass
    // on exactly the failure this case exists to catch. The fixture has always
    // carried the marker; nothing looked for it.
    let large = out.join("large.pdf");
    let rendered = render(app, &large_doc("A4"), &large, A4).await;
    let ok = rendered.is_ok();
    failures += check("large", rendered, &large, expected_pt(A4));
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
    // The fixture and the refusal rule are `missing_path`'s, shared with
    // `progress_case::refused` (#251, #253).
    let fixture = match missing_parent() {
        Ok(fixture) => fixture,
        Err(e) => {
            println!("SMOKE badpath FAIL could not build the fixture: {e}");
            return 1;
        }
    };

    let result = vmark_lib::pdf_export::renderer::render_pdf(
        app.clone(),
        String::new(),
        fixture.path.to_string_lossy().into_owned(),
        A4,
    )
    .await;

    match refusal_verdict(result) {
        Ok(()) => {
            println!("SMOKE badpath PASS refused up front, code=NotFound");
            0
        }
        Err(why) => {
            println!("SMOKE badpath FAIL {why}");
            1
        }
    }
}

/// The set of window labels the app currently holds.
///
/// A COUNT cannot see the failure this is here for. The old check compared
/// `after > before`, so a renderer that closed one of the baseline windows
/// while leaking a replacement of its own reported `after == before` and
/// passed — and a renderer that simply destroyed a pre-existing window made
/// `after < before` and passed too. Identity distinguishes all three.
fn window_labels(app: &tauri::AppHandle) -> BTreeSet<String> {
    app.webview_windows().into_keys().collect()
}

/// Wait for the window set to return to `before`, then report the difference.
///
/// The renderer settles the sink and THEN closes its window, so the caller
/// resumes before the close has been processed — comparing immediately
/// measures a close in flight, not a leak. The contract is that windows return
/// to the baseline promptly, so poll for that with a bound: if they never do,
/// it is a real leak and this still fails.
async fn windows_returned_to(
    name: &str,
    app: &tauri::AppHandle,
    before: &BTreeSet<String>,
) -> usize {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut after = window_labels(app);
    while after != *before && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
        after = window_labels(app);
    }
    if after == *before {
        // Printed, not silent: the transcript is what a caller asserts on, and
        // a check that says nothing when it passes is indistinguishable from
        // one that never ran.
        println!(
            "SMOKE {name} windows PASS back to the {} at the start",
            before.len()
        );
        return 0;
    }
    let added: Vec<&String> = after.difference(before).collect();
    let removed: Vec<&String> = before.difference(&after).collect();
    println!("SMOKE {name} FAIL windows after 10s: leaked {added:?}, lost {removed:?}");
    1
}

/// 20 exports in a row leak no window.
pub async fn sequential(app: &tauri::AppHandle, out: &Path) -> usize {
    let before = window_labels(app);
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

    let leaked = windows_returned_to("sequential", app, &before).await;
    failures += leaked;
    if leaked > 0 {
        // Already reported by the helper, with the labels.
    } else if completed == 20 {
        println!("SMOKE sequential PASS 20 exports");
    } else {
        // Reporting "PASS 20 exports" here is what the old shared-counter
        // version did after breaking out early.
        //
        // `INCOMPLETE`, not a second `FAIL` (audit 20260907 #262). The render
        // error above already printed `FAIL at {i}` and already counted one, so
        // a second FAIL marker made the transcript claim two failures where the
        // count says one — and the transcript is what a caller greps. This line
        // is CONTEXT for the failure already reported, not another one.
        println!("SMOKE sequential INCOMPLETE only {completed}/20 exports rendered");
    }
    failures
}

/// Two at once must not collide on a window label — or on each other's output.
///
/// Run in ROUNDS: `tokio::join!` polls both futures from one task, so a single
/// pass does not guarantee the two renders ever reach label allocation or
/// output setup in the same instant, and a collision window a few syscalls
/// wide can go unvisited. Repeating cheaply raises the chance of landing in
/// it; it does not make the case deterministic, which would need a barrier
/// inside the renderer itself.
const CONCURRENT_ROUNDS: usize = 3;

pub async fn concurrent(app: &tauri::AppHandle, out: &Path) -> usize {
    // Long and distinct. Two-character markers ("c1"/"c2") could not see the
    // failure this case is named for: an output holding BOTH documents still
    // contains its own marker, so a presence check passed on exactly the
    // crossed-output bug. Each side now also asserts the ABSENCE of the other.
    const S1: &str = "CONCURRENT-SENTINEL-ONE";
    const S2: &str = "CONCURRENT-SENTINEL-TWO";

    let before = window_labels(app);
    let mut failures = 0usize;
    for round in 0..CONCURRENT_ROUNDS {
        // The docs and paths are bound first: `tokio::join!` borrows across an
        // await point, so temporaries created inside it do not live long enough.
        let (d1, d2) = (
            doc_for("A4", &format!("<p>{S1}</p>")),
            doc_for("A4", &format!("<p>{S2}</p>")),
        );
        let (p1, p2) = (
            out.join(format!("con-{round}-1.pdf")),
            out.join(format!("con-{round}-2.pdf")),
        );
        let (a, b) = tokio::join!(render(app, &d1, &p1, A4), render(app, &d2, &p2, A4));

        let (ok1, ok2) = (a.is_ok(), b.is_ok());
        let (n1, n2) = (
            format!("concurrent-{round}-1"),
            format!("concurrent-{round}-2"),
        );
        failures += check(&n1, a, &p1, expected_pt(A4));
        failures += check(&n2, b, &p2, expected_pt(A4));
        if ok1 {
            failures += contains_text(&n1, &p1, S1) + lacks_text(&n1, &p1, S2);
        }
        if ok2 {
            failures += contains_text(&n2, &p2, S2) + lacks_text(&n2, &p2, S1);
        }
    }
    // The final window-producing scenario, and until now the only one with no
    // leak check at all: a window leaked specifically by concurrent rendering
    // was invisible.
    failures + windows_returned_to("concurrent", app, &before).await
}
