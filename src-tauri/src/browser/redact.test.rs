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

#[test]
fn redact_drops_the_path_too() {
    // A path routinely carries document ids and magic-login tokens; the origin is the
    // whole of what a log needs.
    assert_eq!(
        redact("https://example.com/reset/abc123token"),
        "https://example.com"
    );
    assert!(!redact("https://example.com/magic-login/tok").contains("tok"));
}

/// Audit 20260903 — every `log::` line in the browser tree that prints a URL goes
/// through `redact`. The refusal log was fixed in WI-S0.13; the navigation-policy,
/// popup and same-document logs then kept printing full URLs, because nothing
/// asserted the class. This scans the SOURCE: a new `{url}` in a log macro fails
/// here, not in a log file six months later.
#[test]
fn every_browser_log_that_prints_a_url_redacts_it() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/browser");
    let mut offenders = Vec::new();
    let mut scanned = 0usize;
    for entry in std::fs::read_dir(&dir).expect("read browser dir").flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if !name.ends_with(".rs") || name.ends_with(".test.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("read source");
        let mut rest = text.as_str();
        while let Some(start) = rest.find("log::") {
            let after = &rest[start..];
            // A macro invocation ends at the first `);` — log lines here never nest one.
            let end = after.find(");").map(|i| i + 2).unwrap_or(after.len());
            let invocation = &after[..end];
            scanned += 1;
            let prints_url = [
                "{url}", "{url:", ", url)", ", url,", ", &url)", ", &url,", "(url)",
            ]
            .iter()
            .any(|needle| invocation.contains(needle));
            if prints_url && !invocation.contains("redact(") {
                offenders.push(format!(
                    "{name}: {}",
                    invocation.lines().next().unwrap_or("")
                ));
            }
            rest = &after[end..];
        }
    }
    assert!(
        scanned > 10,
        "the scanner found only {scanned} log lines — it has stopped seeing them"
    );
    assert!(
        offenders.is_empty(),
        "these log lines print a full URL; route them through redact::redact:\n{}",
        offenders.join("\n")
    );
}
