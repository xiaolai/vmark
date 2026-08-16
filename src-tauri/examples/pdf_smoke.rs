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
//!   cargo run --example pdf_smoke -- <out-dir>
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
//! @module examples/pdf_smoke

use std::path::{Path, PathBuf};

use std::time::Duration;
use tauri::Manager;

use vmark_lib::pdf_export::page_spec::PageSpec;

/// A4 and A5 in points, portrait.
const A4: PageSpec = PageSpec {
    width_pt: 595.28,
    height_pt: 841.89,
};
const A5: PageSpec = PageSpec {
    width_pt: 419.53,
    height_pt: 595.28,
};
const A4_LANDSCAPE: PageSpec = PageSpec {
    width_pt: 841.89,
    height_pt: 595.28,
};

/// Build the document the way production does: an `@page` rule carrying the
/// geometry AND the same geometry sent as `PageSpec`.
///
/// Both are required because the three platforms read different ones. macOS is
/// CSS-driven and ignores the spec; Windows and Linux ignore the CSS and read
/// the spec (ADR-PDF1a). A fixture with only one of them passes on some
/// platforms and fails on others for reasons that have nothing to do with the
/// code — which is exactly what the first run of this harness did.
fn doc_for(css_size: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\
         @page{{size:{css_size};margin:0}}\
         body{{font-family:serif;margin:0}}.b{{height:180mm}}</style></head>\
         <body>{body}</body></html>"
    )
}

/// A document guaranteed to exceed 2 MiB, with a sentinel AFTER the boundary
/// so a truncated load is distinguishable from a short one.
fn large_doc(css_size: &str) -> String {
    let filler = "x".repeat(2 * 1024 * 1024 + 64 * 1024);
    doc_for(
        css_size,
        &format!(
            "<p>start</p><div style=\"display:none\">{filler}</div><h1>SENTINEL-PAST-2MIB</h1>"
        ),
    )
}

fn main() {
    let out_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&out_dir).expect("create out dir");

    let app = tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("build tauri app");

    let handle = app.handle().clone();
    let out = out_dir.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let failures = rt.block_on(run_cases(&handle, &out));
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
    const LEGAL: PageSpec = PageSpec {
        width_pt: 612.0,
        height_pt: 1008.0,
    };
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

    // A bad output path must be REFUSED before any print operation starts.
    //
    // This case is why the renderer validates the path itself. On macOS an
    // NSPrintOperation pointed at a nonexistent directory does not fail — it
    // spools the document to the DEFAULT PRINTER. An earlier version of this
    // harness put four blank pages through a real one. The assertion is now
    // that the refusal happens up front, with a code that says so.
    match vmark_lib::pdf_export::renderer::render_pdf(
        app.clone(),
        String::new(),
        "/nonexistent-dir-for-smoke/x.pdf".into(),
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

/// Verify the artifact, not the return value. Page size is extracted from the
/// PDF because a backend that ignores `PageSpec` still returns `Ok`.
fn check(
    name: &str,
    result: Result<(), String>,
    path: &Path,
    expect_pt: Option<(u32, u32)>,
) -> usize {
    if let Err(e) = result {
        println!("SMOKE {name} FAIL render error: {e}");
        return 1;
    }
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            println!("SMOKE {name} FAIL no artifact: {e}");
            return 1;
        }
    };
    if !bytes.starts_with(b"%PDF") {
        println!("SMOKE {name} FAIL not a PDF ({} bytes)", bytes.len());
        return 1;
    }
    let pages = count(&bytes, b"/Type /Page").max(count(&bytes, b"/Type/Page"));
    let size = media_box(&bytes);
    match (expect_pt, size) {
        (Some((w, h)), Some((gw, gh))) if gw.abs_diff(w) <= 2 && gh.abs_diff(h) <= 2 => {
            println!(
                "SMOKE {name} PASS {} bytes, pages~{pages}, {gw}x{gh}pt",
                bytes.len()
            );
            0
        }
        (Some((w, h)), Some((gw, gh))) => {
            println!("SMOKE {name} FAIL page size {gw}x{gh}pt, expected {w}x{h}pt");
            1
        }
        (Some(_), None) => {
            println!("SMOKE {name} FAIL no MediaBox found");
            1
        }
        (None, _) => {
            println!("SMOKE {name} PASS {} bytes", bytes.len());
            0
        }
    }
}

fn count(hay: &[u8], needle: &[u8]) -> usize {
    hay.windows(needle.len()).filter(|w| *w == needle).count()
}

/// First `/MediaBox [a b c d]`, rounded to whole points.
fn media_box(bytes: &[u8]) -> Option<(u32, u32)> {
    let tag = b"/MediaBox";
    let at = bytes.windows(tag.len()).position(|w| w == tag)?;
    let open = bytes[at..].iter().position(|&c| c == b'[')? + at + 1;
    let close = bytes[open..].iter().position(|&c| c == b']')? + open;
    let text = std::str::from_utf8(&bytes[open..close]).ok()?;
    let v: Vec<f64> = text
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    if v.len() != 4 {
        return None;
    }
    Some((
        ((v[2] - v[0]).round()) as u32,
        ((v[3] - v[1]).round()) as u32,
    ))
}
