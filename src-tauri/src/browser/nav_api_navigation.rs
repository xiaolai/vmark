//! The pure half of owning an API-initiated navigation (audit 20260903, journey 37).
//!
//! `WKWebView.URL` is KVO-observed to catch SAME-DOCUMENT navigations — a
//! `pushState`, a fragment change — which no public `WKNavigationDelegate` callback
//! reports. The observer tells the two kinds of URL change apart with the delegate's
//! `loading` flag: a full load changes `URL` too, and `did_start_provisional` raises
//! the flag so that change is left to `did_commit`.
//!
//! That ordering holds for a navigation the PAGE starts (a link, a form): WebKit
//! calls the delegate before it publishes the URL. It does NOT hold for a navigation
//! the API starts — `loadRequest`, `goBack`, `goForward`: those publish the target
//! URL SYNCHRONOUSLY, inside the call, and `didStartProvisionalNavigation` arrives
//! later from the web process. So the observer saw every API-initiated load's URL
//! change with the flag still down and took it for a same-document navigation: for
//! `navigate` the registry refused it (the command had already cleared the committed
//! page) and a WARN was logged on every load; for back/forward it SUCCEEDED — the
//! registry recorded the history target as the committed page, bumped the generation
//! and emitted `browser://navigated` for a page the view had not loaded, and the real
//! commit then did it all again.
//!
//! **What WebKit does and does not tell the caller** — measured, not recalled
//! (`nav_api_navigation_native.test.rs`, a real `WKWebView`): every one of these calls
//! returns a `WKNavigation` and reads `isLoading` true on return, for a cross-document
//! move AND for a same-document history move (a `pushState` entry), so nothing at
//! call time can classify the move. Afterwards it is unambiguous: a cross-document
//! move reports `didStartProvisionalNavigation`; a same-document move reports no start
//! and the view goes idle.
//!
//! The rule, in two halves. [`own`] raises the flag ACROSS the call, so the
//! synchronous URL change is left alone; a call that created no navigation (nowhere
//! to go) restores the flag and is done. The caller then pumps the run loop — which
//! `navigate` and `go_history` already did to drive the load — and [`Owned::settle`]
//! reads the two signals: a start was reported, so the load's own start and commit
//! own the flag from here; or no start and the view is idle, so the change was within
//! the document — the flag goes back to what it was and, if it was down, the observer
//! runs explicitly now, because its URL change arrived while the flag was up and
//! nothing else will deliver it. A start that has not arrived while WebKit still
//! reports loading leaves the flag raised for it (`Pending`).
//!
//! @coordinates-with browser/nav_kvo_macos.rs — the caller, `NavDelegate::api_navigation`
//! @coordinates-with browser/surface_macos.rs — `navigate` and `go_history` go through it

use std::cell::Cell;

/// A navigation call that created a `WKNavigation`, with the flag raised across it.
/// Consumed by [`Owned::settle`] once the run loop has been pumped.
#[derive(Debug, PartialEq, Eq)]
#[must_use = "settle the flag once the run loop has been pumped"]
pub struct Owned {
    was_loading: bool,
}

/// What the caller must do once the navigation has settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Settlement {
    /// A provisional start was reported: the load's start and commit own the flag.
    CrossDocument,
    /// No start, and the view is idle: the change was within the document. The flag
    /// is back to what it was; `observe_now` says whether the same-document observer
    /// must run explicitly (the flag was down, so the change was its to handle).
    SameDocument { observe_now: bool },
    /// No start yet, but WebKit still reports loading: the flag stays raised for the
    /// start to come.
    Pending,
}

/// Run `start` — the API call that publishes `URL` synchronously — with `loading`
/// raised. `start` returns whether WebKit created a `WKNavigation`; when it did not,
/// nothing will change and the flag is restored at once.
pub fn own(loading: &Cell<bool>, start: impl FnOnce() -> bool) -> Option<Owned> {
    let was_loading = loading.get();
    loading.set(true);
    if start() {
        return Some(Owned { was_loading });
    }
    loading.set(was_loading);
    None
}

impl Owned {
    /// Settle the flag by what the pump observed: whether a provisional start was
    /// reported since the call, and whether WebKit still reports loading.
    pub fn settle(self, loading: &Cell<bool>, saw_start: bool, still_loading: bool) -> Settlement {
        if saw_start {
            return Settlement::CrossDocument;
        }
        if still_loading {
            return Settlement::Pending;
        }
        loading.set(self.was_loading);
        Settlement::SameDocument {
            observe_now: !self.was_loading,
        }
    }
}

#[cfg(test)]
#[path = "nav_api_navigation.test.rs"]
mod tests;
