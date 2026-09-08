//! Tests for the one-shot navigation decision (#233, #238, #227): the
//! callback orders WebView2 is documented to produce, pinned without a
//! WebView2 — including the one a `Source` check cannot survive, the initial
//! page's completion delivered after `Source` has advanced to the document.

use super::*;

const DOC: &str = "file:///C:/Users/x/AppData/Local/Temp/vmark-pdf-export-Ab3xYz.html";

/// The id WebView2 gave the initial page's navigation, before any handler
/// existed to see it start.
const BLANK_NAV: u64 = 1;
/// The id it gives the document's navigation, seen at its `NavigationStarting`.
const DOC_NAV: u64 = 2;

fn gate() -> OneShotNavigation {
    OneShotNavigation::for_document(DOC)
}

/// A gate that has seen the document's navigation START — the state every
/// completion after `Navigate()` finds it in.
fn started() -> OneShotNavigation {
    let mut nav = gate();
    assert!(nav.starting(Some(DOC), DOC_NAV), "the document's own start");
    nav
}

fn completed(navigation_id: Option<u64>, source: Option<&str>, succeeded: bool) -> Completion<'_> {
    Completion {
        navigation_id,
        source,
        succeeded,
    }
}

/// A sink that is still waiting.
fn waiting() -> bool {
    true
}

/// A sink whose caller has given up.
fn gone() -> bool {
    false
}

/// A claim that must never be asked for.
fn never() -> bool {
    panic!("claim must only be made for a loaded document")
}

#[test]
fn the_documents_successful_completion_is_acted_on_once() {
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
    // A reload, a redirect, a second delivery: never a second print.
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), never),
        NavigationStep::Ignore
    );
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), false), never),
        NavigationStep::Ignore
    );
}

#[test]
fn a_late_initial_page_completion_after_source_advanced_is_not_the_documents() {
    // The verifier's residual on #233/#238: the render window opens on
    // about:blank, its completion is delivered late — AFTER the document's
    // navigation committed and `Source` already reads the document's URL.
    // A `Source` check calls that the document's completion and prints a
    // page that has not finished loading; the id says whose it is.
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(Some(BLANK_NAV), Some(DOC), true), never),
        NavigationStep::Ignore,
        "the initial page's completion, whatever Source says now"
    );
    assert_eq!(
        nav.classify(completed(Some(BLANK_NAV), Some(DOC), false), never),
        NavigationStep::Ignore,
        "nor is its failure the document's"
    );
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded,
        "the document's own completion still counts after the blank one"
    );
}

#[test]
fn a_late_initial_page_completion_before_the_document_started_is_ignored() {
    // Delivered between the handler's registration and `Navigate()`: no id
    // has been recorded yet, and the name check that decides then sees the
    // initial page — never the document, whose navigation has not committed.
    let mut nav = gate();
    assert_eq!(
        nav.classify(completed(Some(BLANK_NAV), Some(INITIAL_PAGE), true), never),
        NavigationStep::Ignore
    );
    assert!(nav.starting(Some(DOC), DOC_NAV));
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
}

#[test]
fn a_completion_for_some_other_navigation_is_not_the_documents() {
    // Any navigation that is not the document's: its outcome says nothing
    // about the document and must not consume the shot — not even when
    // `Source` happens to read the document's URL at the time.
    let mut nav = started();
    for (id, source) in [
        (
            3,
            "file:///C:/Users/x/AppData/Local/Temp/vmark-pdf-export-OTHER1.html",
        ),
        (4, "https://example.com/"),
        (5, "edge://blank"),
        (6, DOC),
    ] {
        assert_eq!(
            nav.classify(completed(Some(id), Some(source), true), never),
            NavigationStep::Ignore,
            "navigation {id}"
        );
        assert_eq!(
            nav.classify(completed(Some(id), Some(source), false), never),
            NavigationStep::Ignore,
            "a stranger's FAILURE must not fail the export either ({id})"
        );
    }
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
}

#[test]
fn only_the_first_navigation_whose_uri_names_the_document_is_recorded() {
    let mut nav = gate();
    assert!(
        !nav.starting(Some(INITIAL_PAGE), BLANK_NAV),
        "the initial page's start, if it is ever seen"
    );
    assert!(
        !nav.starting(None, 7),
        "a start whose URI cannot be read names nothing"
    );
    assert!(!nav.starting(
        Some("file:///C:/Users/x/AppData/Local/Temp/vmark-pdf-export-OTHER1.html"),
        8
    ));
    assert!(nav.starting(Some(DOC), DOC_NAV));
    assert!(
        !nav.starting(Some(DOC), 9),
        "the shot is the document's FIRST navigation"
    );
    assert_eq!(
        nav.classify(completed(Some(9), Some(DOC), true), never),
        NavigationStep::Ignore
    );
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
}

#[test]
fn the_directory_part_may_be_canonicalized_and_the_document_still_matches() {
    // WebView2 owns the spelling of the directory: drive-letter case, and
    // the percent-encoding of a non-ASCII profile path. The file NAME is
    // what identifies the document, and it survives all of that — at the
    // start, where the id is learned, and in the name fallback.
    let unicode_doc = "file:///C:/Users/测试/AppData/Local/Temp/vmark-pdf-export-Ab3xYz.html";
    let canonical =
        "file:///c:/Users/%E6%B5%8B%E8%AF%95/AppData/Local/Temp/vmark-pdf-export-AB3XYZ.html";
    let mut nav = OneShotNavigation::for_document(unicode_doc);
    assert!(nav.starting(Some(canonical), DOC_NAV));
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(canonical), true), waiting),
        NavigationStep::Loaded
    );

    let mut nav = OneShotNavigation::for_document(unicode_doc);
    assert_eq!(
        nav.classify(completed(None, Some(canonical), true), waiting),
        NavigationStep::Loaded,
        "the name fallback folds the same way"
    );
}

#[test]
fn a_query_or_fragment_does_not_hide_the_document() {
    let mut nav = gate();
    let with_fragment = format!("{DOC}#top");
    assert!(nav.starting(Some(&with_fragment), DOC_NAV));
    let mut nav = gate();
    assert_eq!(
        nav.classify(completed(None, Some(&with_fragment), true), waiting),
        NavigationStep::Loaded
    );
}

#[test]
fn a_failed_document_navigation_is_settled_once_and_never_claims() {
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), false), never),
        NavigationStep::Failed
    );
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), never),
        NavigationStep::Ignore
    );
}

#[test]
fn an_unreadable_id_falls_back_to_the_name_and_nothing_readable_is_the_document() {
    // `NavigationId` failing on a live event-args object is the extreme
    // case; the best remaining evidence is the name, as before the ids. A
    // `Source` that cannot be read either must not make the export hang
    // until its timeout: the event is taken as the document's, success or
    // failure as flagged.
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(None, Some(INITIAL_PAGE), true), never),
        NavigationStep::Ignore
    );
    assert_eq!(
        nav.classify(completed(None, Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(None, None, true), waiting),
        NavigationStep::Loaded
    );
    let mut nav = gate();
    assert_eq!(
        nav.classify(completed(None, None, false), never),
        NavigationStep::Failed
    );
}

#[test]
fn a_document_that_loaded_for_a_caller_that_left_is_abandoned_once() {
    // #227: the claim is part of the decision. A caller whose bounded wait
    // ended gets a teardown, not a print or a dialog — and only once.
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), gone),
        NavigationStep::Abandoned
    );
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), never),
        NavigationStep::Ignore
    );
}

#[test]
fn a_completion_after_the_document_loaded_changes_nothing() {
    let mut nav = started();
    assert_eq!(
        nav.classify(completed(Some(DOC_NAV), Some(DOC), true), waiting),
        NavigationStep::Loaded
    );
    assert_eq!(
        nav.classify(completed(Some(BLANK_NAV), Some(INITIAL_PAGE), true), never),
        NavigationStep::Ignore
    );
    assert_eq!(
        nav.classify(completed(None, None, true), never),
        NavigationStep::Ignore
    );
}

#[test]
fn a_gate_with_no_document_name_falls_back_to_excluding_the_initial_page() {
    // Cannot happen for a tempfile, which always has a name; pinned so the
    // fallback stays the old behaviour rather than "accept nothing".
    let mut nav = OneShotNavigation::for_document("file:///");
    assert!(!nav.starting(Some(INITIAL_PAGE), BLANK_NAV));
    assert_eq!(
        nav.classify(completed(None, Some(INITIAL_PAGE), true), never),
        NavigationStep::Ignore
    );
    assert_eq!(
        nav.classify(completed(None, Some("file:///C:/x.html"), true), waiting),
        NavigationStep::Loaded
    );
}
