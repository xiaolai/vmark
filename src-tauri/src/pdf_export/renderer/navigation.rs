//! The one-shot decision a `NavigationCompleted`-style callback makes.
//!
//! Purpose: WebView2 delivers `NavigationCompleted` for EVERY navigation the
//! throwaway render window makes — including the `about:blank` it opens on,
//! whose completion can arrive after the handler was registered and the real
//! navigation started. Acting on it printed a blank page and reported
//! success (#233, #238). And nothing stopped the handler running twice.
//!
//! The gate knows the DOCUMENT it is waiting for and answers three questions
//! in one place, so the callback that drives it is a plain `match`:
//!   - **Is this the document's completion?** Decided by NAVIGATION ID, the
//!     one thing WebView2 attaches to both ends of a navigation: the
//!     `NavigationStarting` event carries the URI and the id, and the
//!     `NavigationCompleted` event carries the id and nothing else. The gate
//!     records the id of the first navigation whose URI names the document —
//!     its FILE NAME, random ASCII, case-folded, because the directory part
//!     is what WebView2 canonicalizes (drive-letter case, the percent-encoding
//!     of a non-ASCII profile path) — and a completion is the document's iff
//!     it carries that id. The webview's current `Source` cannot answer this
//!     question: `Source` advances when the document's navigation COMMITS,
//!     so the initial page's completion delivered after that reads as the
//!     document's under a `Source` check, and the print starts on a page that
//!     has not finished loading. `Source` is kept only as the fallback for an
//!     id that could not be read on one side or the other; with nothing
//!     readable at all the event is taken as the document's, so a broken
//!     getter fails loud rather than hangs.
//!   - **Has it been handled?** Once, ever: a reload, a redirect, a second
//!     delivery is `Ignore`.
//!   - **Is the caller still waiting?** The sink's claim is made HERE, as
//!     part of the decision (#227): a document that loaded for a caller that
//!     has given up is `Abandoned`, and the callback tears down instead of
//!     printing or presenting.
//!
//! The decision is pure and lives here, compiled on every platform, so the
//! cases can be pinned by `cargo test` on the machine the project develops
//! on, where the COM wiring itself only cross-compiles (#235, #240).
//!
//! @coordinates-with windows_nav.rs — the only production caller
//! @coordinates-with sink.rs — the claim this makes on `Loaded`
//! @module pdf_export/renderer/navigation

/// The page the render window is created on; its completion is never ours.
pub(super) const INITIAL_PAGE: &str = "about:blank";

/// What the handler should do with one completion event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NavigationStep {
    /// Not the document's navigation, or already handled: do nothing.
    Ignore,
    /// The document loaded and the caller is waiting; act exactly once.
    Loaded,
    /// The document loaded but the caller had stopped waiting (#227): settle
    /// as cancelled and tear the window down, exactly once.
    Abandoned,
    /// The document failed to load; settle the failure exactly once.
    Failed,
}

/// One `NavigationCompleted` event, as the handler read it.
#[derive(Debug, Clone, Copy)]
pub(super) struct Completion<'a> {
    /// The event's own `NavigationId`; `None` if it could not be read.
    pub(super) navigation_id: Option<u64>,
    /// The webview's `Source` when the event fired; `None` if it could not
    /// be read. Consulted only when the ids cannot decide.
    pub(super) source: Option<&'a str>,
    /// The event's `IsSuccess`.
    pub(super) succeeded: bool,
}

/// Consumes the first completion that belongs to the document.
#[derive(Debug)]
pub(super) struct OneShotNavigation {
    handled: bool,
    /// The document's file name, as it appears in its `file://` URL.
    document: Option<String>,
    /// The id `NavigationStarting` reported for the document's own
    /// navigation, once it has.
    document_navigation: Option<u64>,
}

impl OneShotNavigation {
    /// A gate for the document at `file_url`.
    pub(super) fn for_document(file_url: &str) -> Self {
        Self {
            handled: false,
            document: last_segment(file_url).map(str::to_owned),
            document_navigation: None,
        }
    }

    /// A `NavigationStarting` event: `uri` is the navigation's URI (`None`
    /// if it could not be read) and `navigation_id` its id. The first
    /// navigation whose URI names the document is remembered as the
    /// document's; returns whether this one was.
    pub(super) fn starting(&mut self, uri: Option<&str>, navigation_id: u64) -> bool {
        if self.document_navigation.is_some() {
            return false;
        }
        let Some(uri) = uri else {
            return false;
        };
        if !self.names_document(uri) {
            return false;
        }
        self.document_navigation = Some(navigation_id);
        true
    }

    /// Classify a completion; `claim` is the sink's — called only for a
    /// loaded document, and only once.
    pub(super) fn classify(
        &mut self,
        completion: Completion<'_>,
        claim: impl FnOnce() -> bool,
    ) -> NavigationStep {
        if self.handled {
            return NavigationStep::Ignore;
        }
        if !self.is_document(completion) {
            // The initial page's own completion delivered late, or any
            // navigation that is not ours: it says nothing about the
            // document, and must not consume the shot.
            return NavigationStep::Ignore;
        }
        self.handled = true;
        if !completion.succeeded {
            return NavigationStep::Failed;
        }
        if claim() {
            NavigationStep::Loaded
        } else {
            NavigationStep::Abandoned
        }
    }

    /// The id decides when it is known on both sides; otherwise the name
    /// the webview's `Source` carries, and with nothing readable the event
    /// is the document's (loud, not hung).
    fn is_document(&self, completion: Completion<'_>) -> bool {
        match (self.document_navigation, completion.navigation_id) {
            (Some(document), Some(id)) => document == id,
            _ => completion
                .source
                .is_none_or(|source| self.names_document(source)),
        }
    }

    fn names_document(&self, source: &str) -> bool {
        match (&self.document, last_segment(source)) {
            (Some(document), Some(name)) => document.eq_ignore_ascii_case(name),
            // Nothing to compare with: fall back to excluding the one URL
            // known not to be ours.
            (None, _) => source != INITIAL_PAGE,
            (Some(_), None) => false,
        }
    }
}

/// The last path segment of a URL, before any query or fragment.
fn last_segment(url: &str) -> Option<&str> {
    url.split(['?', '#'])
        .next()
        .and_then(|path| path.rsplit('/').next())
        .filter(|segment| !segment.is_empty())
}

#[cfg(test)]
#[path = "navigation.test.rs"]
mod tests;
