//! `vmark-trusted://` response tests (issue #1273).
//!
//! These pin the RESPONSE, which is the whole point of the scheme: a
//! srcdoc/blob/data frame inherits the app's `script-src 'self'` and can never
//! run a script, so the trusted document has to arrive with its own CSP header.

use super::*;

const DOC: &str = "<!doctype html><p>hi</p><script>window.ran=1</script>";

fn csp_of(res: &tauri::http::Response<Vec<u8>>) -> String {
    res.headers()
        .get("Content-Security-Policy")
        .expect("every response carries a CSP")
        .to_str()
        .unwrap()
        .to_string()
}

fn granted() -> (TrustedHtmlState, String) {
    let state = TrustedHtmlState::default();
    let token = state.grant("main", DOC.to_string()).unwrap();
    (state, token)
}

#[test]
fn serves_the_granted_document_verbatim() {
    let (state, token) = granted();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}"));
    assert_eq!(res.status(), 200);
    assert_eq!(res.body(), DOC.as_bytes(), "content is served unsanitized");
}

#[test]
fn serves_html_with_an_explicit_utf8_charset() {
    let (state, token) = granted();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}"));
    assert_eq!(
        res.headers().get("Content-Type").unwrap(),
        "text/html; charset=utf-8"
    );
}

#[test]
fn cjk_content_survives_the_round_trip() {
    let state = TrustedHtmlState::default();
    let doc = "<p>用普通温度计测量温度</p>";
    let token = state.grant("main", doc.to_string()).unwrap();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}"));
    assert_eq!(res.body(), doc.as_bytes());
}

#[test]
fn the_response_csp_permits_inline_script_and_nothing_networked() {
    let (state, token) = granted();
    let csp = csp_of(&respond(&state, &format!("vmark-trusted://doc/{token}")));
    assert!(csp.contains("default-src 'none'"), "{csp}");
    assert!(csp.contains("script-src 'unsafe-inline'"), "{csp}");
    // Requirement 9 — no network, by omission of connect-src under a
    // default-src of 'none'.
    assert!(!csp.contains("connect-src"), "{csp}");
    assert!(!csp.contains("http:"), "{csp}");
    assert!(!csp.contains("https:"), "{csp}");
    assert!(!csp.contains('*'), "{csp}");
}

#[test]
fn the_response_csp_blocks_navigation_and_form_posting() {
    let (state, token) = granted();
    let csp = csp_of(&respond(&state, &format!("vmark-trusted://doc/{token}")));
    assert!(csp.contains("base-uri 'none'"), "{csp}");
    assert!(csp.contains("form-action 'none'"), "{csp}");
}

/// Regression: `frame-ancestors 'self'` shipped here and silently broke the
/// whole feature — `'self'` is the FRAMED document's origin, not the
/// embedder's, so the app could never host the iframe. Every existing test
/// passed, because they assert the CSP string rather than that anything loads.
///
/// The directive must stay absent unless it names the real app origins, which
/// differ per platform. Isolation comes from the opaque-origin sandbox.
#[test]
fn the_response_csp_does_not_restrict_frame_ancestors() {
    let (state, token) = granted();
    let csp = csp_of(&respond(&state, &format!("vmark-trusted://doc/{token}")));
    assert!(
        !csp.contains("frame-ancestors"),
        "frame-ancestors blocks the cross-origin app parent: {csp}"
    );
}

/// `'unsafe-eval'` is deliberately absent: nothing in the motivating use case
/// needs it, and requirement 7 is minimum capability. Adding it is a decision,
/// not a tidy-up.
#[test]
fn the_response_csp_does_not_permit_eval() {
    let (state, token) = granted();
    let csp = csp_of(&respond(&state, &format!("vmark-trusted://doc/{token}")));
    assert!(!csp.contains("unsafe-eval"), "{csp}");
}

#[test]
fn responses_are_nosniff() {
    let (state, token) = granted();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}"));
    assert_eq!(
        res.headers().get("X-Content-Type-Options").unwrap(),
        "nosniff"
    );
}

#[test]
fn an_unknown_token_is_404_with_an_empty_body() {
    let state = TrustedHtmlState::default();
    let res = respond(&state, &format!("vmark-trusted://doc/{}", "a".repeat(64)));
    assert_eq!(res.status(), 404);
    assert!(res.body().is_empty());
}

#[test]
fn a_revoked_token_stops_being_served() {
    let (state, token) = granted();
    assert_eq!(
        respond(&state, &format!("vmark-trusted://doc/{token}")).status(),
        200
    );
    state.revoke(&token);
    assert_eq!(
        respond(&state, &format!("vmark-trusted://doc/{token}")).status(),
        404
    );
}

/// A 404 is still a response the webview parses, so it carries the same
/// restrictive headers — a refusal must not be a laxer surface than a hit.
#[test]
fn refusals_carry_the_same_restrictive_headers() {
    let state = TrustedHtmlState::default();
    let res = respond(&state, "vmark-trusted://doc/nope");
    assert!(csp_of(&res).contains("default-src 'none'"));
    assert_eq!(
        res.headers().get("X-Content-Type-Options").unwrap(),
        "nosniff"
    );
}

#[test]
fn malformed_tokens_are_refused_without_a_lookup() {
    let (state, _token) = granted();
    for uri in [
        "vmark-trusted://doc/",
        "vmark-trusted://doc",
        "vmark-trusted://doc/../../etc/passwd",
        "vmark-trusted://doc/NOTHEX!!",
        "vmark-trusted://doc/short",
        "not even a uri",
        "",
    ] {
        assert_eq!(respond(&state, uri).status(), 404, "uri: {uri}");
    }
}

/// The token identifies the grant; nothing else in the URL may select content.
/// Pinned so a later "serve a file too" overload cannot turn this scheme into
/// a filesystem read primitive.
#[test]
fn a_path_after_the_token_does_not_select_anything() {
    let (state, token) = granted();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}/index.html"));
    assert_eq!(res.status(), 404);
}

#[test]
fn a_query_or_fragment_after_the_token_still_resolves() {
    let (state, token) = granted();
    assert_eq!(
        respond(&state, &format!("vmark-trusted://doc/{token}?v=2")).status(),
        200
    );
    assert_eq!(
        respond(&state, &format!("vmark-trusted://doc/{token}#top")).status(),
        200
    );
}

#[test]
fn refuse_is_a_locked_down_404() {
    let res = refuse();
    assert_eq!(res.status(), 404);
    assert!(res.body().is_empty());
    assert!(csp_of(&res).contains("default-src 'none'"));
}

#[test]
fn an_empty_document_is_served_rather_than_refused() {
    let state = TrustedHtmlState::default();
    let token = state.grant("main", String::new()).unwrap();
    let res = respond(&state, &format!("vmark-trusted://doc/{token}"));
    assert_eq!(res.status(), 200);
    assert!(res.body().is_empty());
}
