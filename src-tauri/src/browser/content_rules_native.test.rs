//! Audit 20260903 round 4, #16 — the AI destination rules compile and attach
//! through the REAL `WKContentRuleListStore`, under `cargo test`.
//!
//! The generator tests (`ai_content_rules.test.rs`) check the JSON we emit against
//! OUR reading of WebKit's dialect; only WebKit's compiler can say whether the
//! dialect accepts it, and only a real `addContentRuleList` can say the list
//! attaches. Both postures go through a temporary store here, and a rule WebKit's
//! dialect rejects (alternation) must come back as WebKit's own refusal, not our
//! timeout.
//!
//! **Why a child process, and why before `main`.** WebKit initialises only on the
//! process's main thread: its first use from any other thread traps in
//! `WebKit::runInitializationCode` (`EXC_BREAKPOINT`, `brk #0xc471` — observed
//! from a dedicated "WebKit thread" while writing this file), and pumping the
//! main run loop from another thread is undefined anyway. libtest never runs a
//! test body on the main thread, and the main thread never pumps its run loop while
//! it waits for the tests. So the probe runs where WebKit demands: this test binary
//! is spawned again, and a static initializer — which runs on the MAIN thread,
//! before libtest's `main` — sees `PROBE_ENV`, runs every step with a real
//! `MainThreadMarker`, writes a JSON report, and exits before `main` ever starts.
//! The parent reads the report and asserts on it; the child runs once per test
//! process and the three tests share its report.

use super::*;
use objc2_foundation::NSURL;
use std::path::Path;
use std::sync::OnceLock;

/// Set in the child: where to write the report. Its presence IS the request.
const REPORT_ENV: &str = "VMARK_CONTENT_RULES_PROBE_REPORT";
/// Set in the child: the directory the temporary `WKContentRuleListStore` lives in.
const STORE_ENV: &str = "VMARK_CONTENT_RULES_PROBE_STORE";

/// One posture's journey through the real store. Errors are `NativeSurfaceError`
/// renderings — the parent parses the class back.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct PostureReport {
    allow_loopback: bool,
    /// The compiled list's own identifier, or why it did not compile.
    compiled: Result<String, String>,
    /// Was the list found in the store afterwards (compiled AND persisted)?
    persisted: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ProbeReport {
    postures: Vec<PostureReport>,
    /// `url-filter` with alternation, which WebKit's dialect rejects.
    alternation: Result<(), String>,
    /// A rule list that is not JSON at all.
    not_json: Result<(), String>,
}

// ── child side ─────────────────────────────────────────────────────────────

/// Runs on the main thread before `main` (see the module doc). Inert unless the
/// probe environment is set, which only `probe()` below does.
extern "C" fn probe_entry() {
    let Ok(report_path) = std::env::var(REPORT_ENV) else {
        return;
    };
    let store_dir = std::env::var(STORE_ENV).expect("the probe names its store directory");
    let mtm = MainThreadMarker::new().expect("static initializers run on the main thread");
    let report = objc2::rc::autoreleasepool(|_| run_probe(Path::new(&store_dir), mtm));
    let json = serde_json::to_string(&report).expect("the report serializes");
    std::fs::write(&report_path, json).expect("write the probe report");
    std::process::exit(0);
}

#[used]
#[link_section = "__DATA,__mod_init_func"]
static PROBE_INIT: extern "C" fn() = probe_entry;

/// A store rooted in `dir`, so nothing here touches the user's caches.
fn temp_store(dir: &Path, mtm: MainThreadMarker) -> Retained<WKContentRuleListStore> {
    std::fs::create_dir_all(dir).expect("create the store directory");
    let path = NSString::from_str(dir.to_str().expect("utf-8 temp path"));
    let url = NSURL::fileURLWithPath_isDirectory(&path, true);
    unsafe { WKContentRuleListStore::storeWithURL(Some(&url), mtm) }
        .expect("WebKit opens a store in a temporary directory")
}

/// Is `identifier` persisted in `store`? Pumps like `compile_list` does.
fn look_up(store: &WKContentRuleListStore, identifier: &str) -> bool {
    let id = NSString::from_str(identifier);
    let found: Rc<RefCell<Option<bool>>> = Rc::new(RefCell::new(None));
    let sink = found.clone();
    let handler =
        block2::RcBlock::new(move |list: *mut WKContentRuleList, _error: *mut NSError| {
            *sink.borrow_mut() = Some(!list.is_null());
        });
    unsafe {
        store.lookUpContentRuleListForIdentifier_completionHandler(Some(&id), Some(&handler))
    };
    super::super::pump_until(&NSRunLoop::currentRunLoop(), COMPILE_TIMEOUT, 0.05, || {
        found.borrow().is_some()
    });
    let persisted = found.borrow().unwrap_or(false);
    persisted
}

fn run_probe(store_dir: &Path, mtm: MainThreadMarker) -> ProbeReport {
    let store = temp_store(store_dir, mtm);
    let postures = [false, true]
        .into_iter()
        .map(|allow_loopback| {
            let compiled = compile(&store, allow_loopback)
                .map(|list| {
                    // The attach half, on a real configuration.
                    let config = unsafe { WKWebViewConfiguration::new(mtm) };
                    attach(&config, &list);
                    unsafe { list.identifier() }.to_string()
                })
                .map_err(|error| error.to_string());
            PostureReport {
                allow_loopback,
                compiled,
                persisted: look_up(&store, &identifier(allow_loopback)),
            }
        })
        .collect();
    let refused = |id: &str, encoded: &str| {
        compile_list(&store, id, encoded)
            .map(|_| ())
            .map_err(|error| error.to_string())
    };
    ProbeReport {
        postures,
        alternation: refused(
            "vmark-test-alternation",
            r#"[{"trigger":{"url-filter":"a|b"},"action":{"type":"block"}}]"#,
        ),
        not_json: refused("vmark-test-not-json", "not a rule list"),
    }
}

// ── parent side ────────────────────────────────────────────────────────────

/// Spawn this test binary as the probe (once per test process) and read its report.
fn probe() -> &'static ProbeReport {
    static REPORT: OnceLock<ProbeReport> = OnceLock::new();
    REPORT.get_or_init(|| {
        let dir = tempfile::tempdir().expect("temp dir for the store and the report");
        let report_path = dir.path().join("report.json");
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .env(REPORT_ENV, &report_path)
            .env(STORE_ENV, dir.path().join("store"))
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

/// WebKit's refusal, as the typed class — never our own timeout wearing it.
fn assert_webkit_refused(outcome: &Result<(), String>, what: &str) {
    let rendered = outcome
        .as_ref()
        .expect_err(&format!("WebKit must refuse {what}"));
    let error = NativeSurfaceError::parse(rendered);
    assert!(
        matches!(error, NativeSurfaceError::ContentRulesFailed(_)),
        "{what}: {rendered}"
    );
    assert!(
        !error.detail().is_empty(),
        "{what}: the reason must be surfaced"
    );
    assert_ne!(
        error.detail(),
        "timed out compiling the rule list",
        "{what}: a refusal is WebKit's verdict, not our bound elapsing"
    );
}

#[test]
fn both_postures_compile_through_the_real_store_and_attach() {
    let report = probe();
    assert_eq!(report.postures.len(), 2);
    for posture in &report.postures {
        let allow_loopback = posture.allow_loopback;
        let id = posture.compiled.as_ref().unwrap_or_else(|error| {
            panic!("allow_loopback={allow_loopback}: WebKit refused the rules we ship: {error}")
        });
        assert_eq!(
            *id,
            identifier(allow_loopback),
            "the list carries its own identifier"
        );
        assert!(
            posture.persisted,
            "allow_loopback={allow_loopback}: the compiled list is not in the store"
        );
    }
}

#[test]
fn a_rule_webkits_dialect_rejects_is_refused_with_its_reason() {
    // Alternation is not in WebKit's url-filter dialect (`URLFilterParser` reports
    // `Disjunction`).
    assert_webkit_refused(&probe().alternation, "alternation in a url-filter");
}

#[test]
fn malformed_json_is_refused_before_any_rule_is_read() {
    assert_webkit_refused(&probe().not_json, "a rule list that is not JSON");
}
