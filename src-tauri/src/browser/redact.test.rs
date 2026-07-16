use super::redact;

// WI-S0.13 — a log about an authorization decision needs the origin, not the URL.
// The committed URL's query routinely carries session tokens and document ids, and the
// refusal log was writing them verbatim. (Audit, Medium.)
#[test]
fn redact_keeps_the_origin_and_drops_everything_that_can_carry_a_secret() {
    assert_eq!(
        redact("https://example.com/doc/42?session=hunter2#frag"),
        "https://example.com"
    );
    assert!(!redact("https://example.com/p?token=abc123").contains("abc123"));
    assert!(!redact("https://alice:pw@example.com/p").contains("pw"));
    assert_eq!(
        redact("https://example.com:8443/x"),
        "https://example.com:8443"
    );
    assert_eq!(redact("http://example.com:80/x"), "http://example.com");
}

#[test]
fn redact_never_echoes_a_url_it_cannot_canonicalize() {
    assert_eq!(redact("about:blank"), "<opaque>");
    assert_eq!(redact("javascript:alert(1)"), "<opaque>");
    assert_eq!(redact("not a url"), "<opaque>");
}
