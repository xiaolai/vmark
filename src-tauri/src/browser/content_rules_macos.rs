//! Installing the AI destination policy as a `WKContentRuleList` (audit 20260903
//! P-01, macOS). A `#[path]` child of `surface_macos.rs`, so `super::` reaches
//! `pump_until`.
//!
//! **What this covers that the navigation delegate cannot.** The delegate is asked
//! about NAVIGATIONS — the main frame's, and each subframe's — and refuses the
//! private, link-local and metadata destinations `ai_policy.rs` names. It is never
//! asked about a SUBRESOURCE: an `<img src="http://169.254.169.254/…">`, a
//! stylesheet on a LAN host, a `fetch()` to a metadata endpoint, a WebSocket to
//! loopback. A content rule list is evaluated by WebKit for every load the webview
//! makes, in every frame and for every resource type, before the request leaves
//! the machine. The pure rules live in `ai_content_rules.rs`; this file only
//! compiles and attaches them.
//!
//! **Fail closed.** Compilation is asynchronous, so the run loop is pumped (as
//! `browser_store::forget_profile` does) until the handler fires, bounded at five
//! seconds. A compile error or a timeout fails the creation with
//! `CONTENT_RULES_FAILED`: an AI webview is never created without its rules.
//! Human tabs get nothing — a human's page is not reshaped by the AI's policy.
//!
//! **Compiled once per posture.** `WKContentRuleListStore` compiles into a DFA and
//! persists it under an identifier; the compiled list is cached here per
//! `allow_loopback` value, so the first AI tab of each posture pays the compile and
//! later ones attach the cached list. The identifier embeds a digest of the rules
//! (`ai_content_rules::identifier`), so a rules change never resolves to a stale
//! compiled list. A posture change bumps the policy epoch, which makes existing AI
//! tabs stale for driving; their webviews keep the list they were created with.

use crate::browser::ai_content_rules::{identifier, rules_json};
use crate::browser::registry::AutomationMode;
use crate::browser::surface::fail;
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSError, NSRunLoop, NSString};
use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKWebViewConfiguration};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

/// Bound on waiting for the store's compile callback.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(5);

/// What the store's completion handler reports: the compiled list, or why not.
type CompileOutcome = Result<Retained<WKContentRuleList>, String>;

thread_local! {
    /// Compiled lists, keyed by `allow_loopback`. Main-thread-only, like every
    /// other WebKit handle here.
    static COMPILED: RefCell<HashMap<bool, Retained<WKContentRuleList>>> = RefCell::new(HashMap::new());
}

/// Attach the AI destination rules to `config` for an AI-owned webview. A no-op
/// for a human tab. Errors are `CONTENT_RULES_FAILED`-tagged and abort creation.
pub(super) fn configure(
    config: &WKWebViewConfiguration,
    mtm: MainThreadMarker,
    mode: AutomationMode,
    allow_loopback: bool,
) -> Result<(), String> {
    if mode == AutomationMode::Human {
        return Ok(());
    }
    let list = compiled_rules(allow_loopback, mtm)?;
    let controller = unsafe { config.userContentController() };
    unsafe { controller.addContentRuleList(&list) };
    Ok(())
}

/// The compiled rule list for `allow_loopback`, compiling it on first use.
fn compiled_rules(
    allow_loopback: bool,
    mtm: MainThreadMarker,
) -> Result<Retained<WKContentRuleList>, String> {
    if let Some(existing) = COMPILED.with(|m| m.borrow().get(&allow_loopback).cloned()) {
        return Ok(existing);
    }
    let list = compile(allow_loopback, mtm)?;
    COMPILED.with(|m| m.borrow_mut().insert(allow_loopback, list.clone()));
    Ok(list)
}

/// Compile the rules through the default store, pumping the run loop until the
/// completion handler answers or the bound elapses.
fn compile(
    allow_loopback: bool,
    mtm: MainThreadMarker,
) -> Result<Retained<WKContentRuleList>, String> {
    let store = unsafe { WKContentRuleListStore::defaultStore(mtm) }
        .ok_or_else(|| format!("{}: no default rule-list store", fail::CONTENT_RULES_FAILED))?;
    let id = NSString::from_str(&identifier(allow_loopback));
    let encoded = NSString::from_str(&rules_json(allow_loopback));
    let out: Rc<RefCell<Option<CompileOutcome>>> = Rc::new(RefCell::new(None));
    let sink = out.clone();
    let handler = block2::RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
        let outcome = if !error.is_null() {
            // SAFETY: WebKit hands the handler a valid (autoreleased) error.
            let error: &NSError = unsafe { &*error };
            Err(error.localizedDescription().to_string())
        } else {
            // SAFETY: a non-null list is a valid object for the duration of the
            // call; retaining it is what lets it outlive the handler.
            unsafe { Retained::retain(list) }.ok_or_else(|| "compiled to nothing".to_string())
        };
        *sink.borrow_mut() = Some(outcome);
    });
    unsafe {
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(&id),
            Some(&encoded),
            Some(&handler),
        )
    };
    let run_loop = NSRunLoop::mainRunLoop();
    super::pump_until(&run_loop, COMPILE_TIMEOUT, 0.05, || out.borrow().is_some());
    let outcome = out.borrow_mut().take();
    outcome
        .unwrap_or_else(|| Err("timed out compiling the rule list".to_string()))
        .map_err(|reason| format!("{}: {reason}", fail::CONTENT_RULES_FAILED))
}
