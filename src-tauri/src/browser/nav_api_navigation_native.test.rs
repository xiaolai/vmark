//! Audit 20260903 (journey 37) — the WebKit facts `nav_api_navigation.rs` rests on,
//! measured against a real `WKWebView` under `cargo test`:
//!
//!   1. an API-initiated call (`loadRequest`, `goBack`, `goForward`) publishes the
//!      target URL SYNCHRONOUSLY — `URL` reads it before the call returns, so the KVO
//!      observer has already fired, before any delegate callback could raise the
//!      `loading` flag;
//!   2. nothing at call time classifies the move: a `WKNavigation` comes back and
//!      `isLoading` reads true for a cross-document move AND for a same-document
//!      history move (a `pushState` entry) alike;
//!   3. afterwards WebKit is unambiguous — a cross-document move reports
//!      `didStartProvisionalNavigation`; a same-document move reports no start and
//!      the view goes idle.
//!
//! Same shape as `content_rules_native.test.rs`, for the same reason (WebKit runs only
//! on the process's main thread, so this binary is spawned again and a static
//! initializer runs the probe before `main`). The pages come from a socket this
//! process serves itself — nothing here reaches the network.

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSError, NSRunLoop, NSString, NSURLRequest, NSURL};
use objc2_web_kit::{WKNavigation, WKNavigationDelegate, WKWebView, WKWebViewConfiguration};
use std::cell::Cell;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::Duration;

use super::super::super::super::driver_loop::pump_until;

/// Set in the child: where to write the report. Its presence IS the request.
const REPORT_ENV: &str = "VMARK_API_NAVIGATION_PROBE_REPORT";
const LOAD_TIMEOUT: Duration = Duration::from_secs(15);

/// What one API call did, sampled SYNCHRONOUSLY when it returned and then after
/// the run loop was pumped until the view went idle.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Phase {
    name: String,
    returned_navigation: bool,
    url_after_call: String,
    loading_after_call: bool,
    /// Delegate callbacks delivered while pumping after the call.
    starts: u32,
    finishes: u32,
    url_after_pump: String,
    idle_after_pump: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ProbeReport {
    page_a: String,
    page_b: String,
    pushed_url: String,
    push_state_seen: bool,
    phases: Vec<Phase>,
}

/// Counts the callbacks WebKit delivers.
struct Counters {
    starts: Cell<u32>,
    finishes: Cell<u32>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Counters]
    struct ProbeDelegate;

    unsafe impl NSObjectProtocol for ProbeDelegate {}

    unsafe impl WKNavigationDelegate for ProbeDelegate {
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            self.ivars().starts.set(self.ivars().starts.get() + 1);
        }
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _wv: &WKWebView, _nav: Option<&WKNavigation>) {
            self.ivars().finishes.set(self.ivars().finishes.get() + 1);
        }
    }
);

impl ProbeDelegate {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let counters = Counters {
            starts: Cell::new(0),
            finishes: Cell::new(0),
        };
        unsafe { objc2::msg_send![super(Self::alloc(mtm).set_ivars(counters)), init] }
    }
    fn snapshot(&self) -> (u32, u32) {
        (self.ivars().starts.get(), self.ivars().finishes.get())
    }
}

// ── child side ─────────────────────────────────────────────────────────────

extern "C" fn probe_entry() {
    let Ok(report_path) = std::env::var(REPORT_ENV) else {
        return;
    };
    let mtm = MainThreadMarker::new().expect("static initializers run on the main thread");
    let report = objc2::rc::autoreleasepool(|_| run_probe(mtm));
    let json = serde_json::to_string(&report).expect("the report serializes");
    std::fs::write(&report_path, json).expect("write the probe report");
    std::process::exit(0);
}

#[used]
#[link_section = "__DATA,__mod_init_func"]
static PROBE_INIT: extern "C" fn() = probe_entry;

/// A one-thread HTTP server answering every path with a small page. Returns its origin.
fn serve_pages() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
    let origin = format!("http://{}", listener.local_addr().expect("local addr"));
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") && head.len() < 8192 {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => head.extend_from_slice(&buf[..n]),
                }
            }
            let request = String::from_utf8_lossy(&head);
            let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
            let body = format!("<!doctype html><title>{path}</title><p>{path}</p>");
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    origin
}

fn url_of(web_view: &WKWebView) -> String {
    unsafe { web_view.URL() }
        .and_then(|u| u.absoluteString())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn load(web_view: &WKWebView, url: &str) -> bool {
    let ns = NSURL::URLWithString(&NSString::from_str(url)).expect("a valid URL");
    unsafe { web_view.loadRequest(&NSURLRequest::requestWithURL(&ns)) }.is_some()
}

fn push_state(web_view: &WKWebView, path: &str) {
    let done = Rc::new(Cell::new(false));
    let sink = done.clone();
    let handler = block2::RcBlock::new(move |_v: *mut AnyObject, _e: *mut NSError| {
        sink.set(true);
    });
    let js = NSString::from_str(&format!("history.pushState({{}}, '', '{path}')"));
    unsafe { web_view.evaluateJavaScript_completionHandler(&js, Some(&handler)) };
    pump_until(&NSRunLoop::currentRunLoop(), LOAD_TIMEOUT, 0.02, || {
        done.get()
    });
}

/// Run one API call, sample synchronously, then pump until the view is idle and
/// any load that started has finished — the reading the rule settles on.
fn phase(
    name: &str,
    web_view: &WKWebView,
    delegate: &ProbeDelegate,
    call: impl FnOnce() -> bool,
) -> Phase {
    let before = delegate.snapshot();
    let returned_navigation = call();
    let url_after_call = url_of(web_view);
    let loading_after_call = unsafe { web_view.isLoading() };
    let idle_after_pump = pump_until(&NSRunLoop::currentRunLoop(), LOAD_TIMEOUT, 0.02, || {
        let (starts, finishes) = delegate.snapshot();
        !unsafe { web_view.isLoading() } && (starts == before.0 || finishes > before.1)
    });
    let after = delegate.snapshot();
    Phase {
        name: name.to_string(),
        returned_navigation,
        url_after_call,
        loading_after_call,
        starts: after.0 - before.0,
        finishes: after.1 - before.1,
        url_after_pump: url_of(web_view),
        idle_after_pump,
    }
}

fn run_probe(mtm: MainThreadMarker) -> ProbeReport {
    let origin = serve_pages();
    let page_a = format!("{origin}/a");
    let page_b = format!("{origin}/b");
    let pushed_url = format!("{origin}/a-pushed");
    let config = unsafe { WKWebViewConfiguration::new(mtm) };
    let web_view: Retained<WKWebView> = unsafe {
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), CGRect::ZERO, &config)
    };
    let delegate = ProbeDelegate::new(mtm);
    unsafe { web_view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate))) };

    let mut phases = Vec::new();
    phases.push(phase("load-a", &web_view, &delegate, || {
        load(&web_view, &page_a)
    }));
    phases.push(phase("load-b", &web_view, &delegate, || {
        load(&web_view, &page_b)
    }));
    phases.push(phase("back-cross", &web_view, &delegate, || {
        unsafe { web_view.goBack() }.is_some()
    }));
    push_state(&web_view, "/a-pushed");
    let push_state_seen = pump_until(&NSRunLoop::currentRunLoop(), LOAD_TIMEOUT, 0.02, || {
        url_of(&web_view) == pushed_url
    });
    phases.push(phase("back-same", &web_view, &delegate, || {
        unsafe { web_view.goBack() }.is_some()
    }));
    phases.push(phase("forward-same", &web_view, &delegate, || {
        unsafe { web_view.goForward() }.is_some()
    }));

    ProbeReport {
        page_a,
        page_b,
        pushed_url,
        push_state_seen,
        phases,
    }
}

// ── parent side ────────────────────────────────────────────────────────────

fn probe() -> &'static ProbeReport {
    static REPORT: OnceLock<ProbeReport> = OnceLock::new();
    REPORT.get_or_init(|| {
        let dir = tempfile::tempdir().expect("temp dir for the report");
        let report_path = dir.path().join("report.json");
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .env(REPORT_ENV, &report_path)
            .output()
            .expect("spawn the test binary as the probe");
        assert!(
            output.status.success(),
            "the probe exited {:?}\nstderr:\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        let json = std::fs::read_to_string(&report_path).expect("the probe wrote its report");
        serde_json::from_str(&json).expect("a well-formed report")
    })
}

fn phase_named<'a>(report: &'a ProbeReport, name: &str) -> &'a Phase {
    let found = report.phases.iter().find(|phase| phase.name == name);
    found.unwrap_or_else(|| panic!("no phase {name} in {report:?}"))
}

/// The pages must actually load, or nothing below measures anything.
fn loaded_report() -> &'static ProbeReport {
    let report = probe();
    for name in ["load-a", "load-b"] {
        let phase = phase_named(report, name);
        assert!(
            phase.starts == 1 && phase.finishes == 1 && phase.idle_after_pump,
            "the probe's page did not load: {phase:?}"
        );
    }
    assert!(
        report.push_state_seen,
        "pushState published its URL: {report:?}"
    );
    report
}

#[test]
fn an_api_initiated_call_publishes_its_url_before_it_returns() {
    let report = loaded_report();
    for (name, target) in [
        ("load-a", &report.page_a),
        ("back-cross", &report.page_a),
        ("back-same", &report.page_a),
        ("forward-same", &report.pushed_url),
    ] {
        let phase = phase_named(report, name);
        assert_eq!(
            &phase.url_after_call, target,
            "{name}: URL already reads the target when the call returns — the KVO \
             observer fired inside the call, before any delegate callback"
        );
    }
}

#[test]
fn nothing_at_call_time_tells_a_cross_document_move_from_a_same_document_one() {
    // Both come back with a navigation object and `isLoading` true, so the rule
    // cannot classify at the call; it must wait for what WebKit reports next.
    let report = loaded_report();
    for name in ["back-cross", "back-same", "forward-same"] {
        let phase = phase_named(report, name);
        assert!(
            phase.returned_navigation,
            "{name}: a WKNavigation came back"
        );
        assert!(
            phase.loading_after_call,
            "{name}: isLoading reads true on return"
        );
    }
}

#[test]
fn a_cross_document_move_reports_a_start_and_a_same_document_move_goes_idle_without_one() {
    let report = loaded_report();
    let cross = phase_named(report, "back-cross");
    assert_eq!(
        cross.starts, 1,
        "a cross-document history move starts a load: {cross:?}"
    );
    assert_eq!(cross.finishes, 1);
    assert_eq!(cross.url_after_pump, report.page_a);
    for (name, target) in [
        ("back-same", &report.page_a),
        ("forward-same", &report.pushed_url),
    ] {
        let same = phase_named(report, name);
        assert_eq!(
            same.starts, 0,
            "{name}: no provisional start is reported: {same:?}"
        );
        assert!(
            same.idle_after_pump,
            "{name}: the view goes idle without a load"
        );
        assert_eq!(&same.url_after_pump, target);
    }
}
