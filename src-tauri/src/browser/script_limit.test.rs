// The server-side script-size cap (audit 2026-07-28).
//
// Before this module the 64 KiB bound lived in TWO client-side places only —
// `vmark-mcp-server/src/tools/browser.ts` and `src/hooks/mcpBridge/v2/browserPower.ts` —
// both ABOVE the Tauri command boundary. `browser_eval` took `script: String` with no
// bound at all, so anything invoking the command directly (a compromised webview, a bug
// in the bridge dispatch, a future caller that forgets the check) reached an unbounded
// String. These tests pin the bound itself AND its wiring into every command in
// `commands_auth.rs` that accepts caller-supplied script text.
use super::*;

// --------------------------------------------------------------- the measure

/// The premise the whole cap rests on: `str::len()` on a Rust string is the UTF-8
/// BYTE count, not the character count. This is the one place where the naive
/// length is the correct measure — JS `.length` is UTF-16 code units, which is
/// exactly why both client-side mirrors had to encode explicitly. Confirmed here
/// rather than assumed.
#[test]
fn rust_str_len_is_utf8_bytes_not_chars() {
    assert_eq!("a".len(), 1);
    assert_eq!("中".len(), 3, "a CJK char is 3 UTF-8 bytes");
    assert_eq!("中".chars().count(), 1);
    assert_eq!("𝄞".len(), 4, "an astral char is 4 UTF-8 bytes");
    assert_eq!("𝄞".chars().count(), 1);
}

// ------------------------------------------------------------------ the bound

#[test]
fn oversized_ascii_script_is_refused() {
    let script = "a".repeat(MAX_SCRIPT_BYTES + 1);
    assert!(
        ensure_script_within_limit("script", &script).is_err(),
        "a script one byte over the cap must be refused"
    );
}

/// The byte-vs-char distinction, made load-bearing: this script is well UNDER the
/// cap when counted in characters and well OVER it when counted in UTF-8 bytes.
/// A char-counting implementation would accept it.
#[test]
fn oversized_cjk_script_is_refused_by_bytes_not_chars() {
    let script = "中".repeat(22_000);
    assert_eq!(script.len(), 66_000);
    assert!(
        script.chars().count() < MAX_SCRIPT_BYTES,
        "the char count must be UNDER the cap, or this test proves nothing"
    );
    assert!(
        ensure_script_within_limit("script", &script).is_err(),
        "a CJK script over the cap in BYTES must be refused"
    );
}

#[test]
fn script_just_under_the_limit_is_accepted() {
    let script = "a".repeat(MAX_SCRIPT_BYTES - 1);
    assert!(ensure_script_within_limit("script", &script).is_ok());
}

/// The comparison is `>`, not `>=` — matching both client-side mirrors, so a
/// payload the sidecar lets through is not refused here.
#[test]
fn script_exactly_at_the_limit_is_accepted() {
    let script = "a".repeat(MAX_SCRIPT_BYTES);
    assert_eq!(script.len(), MAX_SCRIPT_BYTES);
    assert!(ensure_script_within_limit("script", &script).is_ok());
}

#[test]
fn multibyte_script_just_under_the_limit_is_accepted() {
    let script = "中".repeat(MAX_SCRIPT_BYTES / 3);
    assert!(script.len() <= MAX_SCRIPT_BYTES);
    assert!(ensure_script_within_limit("script", &script).is_ok());
}

/// This is a SIZE bound and nothing else. Empty input was accepted by the command
/// layer before this change (emptiness is the client's business) and must stay
/// accepted — otherwise the cap silently becomes a content check.
#[test]
fn empty_script_is_accepted_unchanged() {
    assert!(ensure_script_within_limit("script", "").is_ok());
}

#[test]
fn the_cap_is_64_kib() {
    assert_eq!(MAX_SCRIPT_BYTES, 65_536);
}

// ---------------------------------------------------------------- the message

/// The refusal has to be actionable: it names the limit AND the actual size, so a
/// caller can tell how far over it is instead of bisecting.
#[test]
fn refusal_names_the_limit_and_the_actual_size() {
    let script = "a".repeat(MAX_SCRIPT_BYTES + 10);
    let err = ensure_script_within_limit("script", &script).unwrap_err();
    assert!(err.contains("65536"), "error must name the limit: {err}");
    assert!(
        err.contains("65546"),
        "error must name the actual size: {err}"
    );
    assert!(
        err.contains("script"),
        "error must name the argument: {err}"
    );
}

/// A command with several text arguments must say WHICH one tripped.
#[test]
fn refusal_names_the_argument_it_was_given() {
    let script = "a".repeat(MAX_SCRIPT_BYTES + 1);
    let err = ensure_script_within_limit("one-shot eval_script", &script).unwrap_err();
    assert!(err.starts_with("one-shot eval_script "), "got: {err}");
}

// ----------------------------------------------------------------- the wiring
//
// A pure function nobody calls is exactly the failure the audit found on the
// client side. These read `commands_auth.rs`'s own source, so a command that
// drops the call — or a new script-taking command added without one — fails here
// rather than in review. Same technique as `nav_selectors.test.rs`.

/// The body of `pub async fn {name}(` up to the next `#[tauri::command]`.
fn command_body(source: &str, name: &str) -> String {
    let needle = format!("pub async fn {name}(");
    let start = source
        .find(&needle)
        .unwrap_or_else(|| panic!("commands_auth.rs no longer defines `{name}`"));
    let rest = &source[start..];
    let end = rest.find("\n#[tauri::command]").unwrap_or(rest.len());
    rest[..end].to_string()
}

#[test]
fn browser_eval_calls_the_gate() {
    let body = command_body(include_str!("commands_auth.rs"), "browser_eval");
    assert!(
        body.contains("ensure_script_within_limit"),
        "browser_eval must bound its `script` argument server-side"
    );
}

#[test]
fn browser_add_one_shot_calls_the_gate() {
    let body = command_body(include_str!("commands_auth.rs"), "browser_add_one_shot");
    assert!(
        body.contains("ensure_script_within_limit"),
        "browser_add_one_shot must bound its `eval_script` argument server-side — \
         minting authority bound to a script `browser_eval` would refuse stores \
         authority the guard can never spend"
    );
}

/// The enumeration above is only as good as its coverage: if a NEW command in
/// `commands_auth.rs` takes script-ish text, it must be capped too. This fails
/// when one appears, which is the moment to add it.
#[test]
fn no_uncapped_script_argument_exists_in_commands_auth() {
    let source = include_str!("commands_auth.rs");
    let capped = ["browser_eval", "browser_add_one_shot"];
    for line in source.lines() {
        let line = line.trim();
        // Argument declarations naming a script/css payload, e.g. `script: String,`.
        let is_script_arg = (line.starts_with("script:")
            || line.starts_with("eval_script:")
            || line.starts_with("css:")
            || line.starts_with("inject_css:"))
            && line.contains("String");
        if !is_script_arg {
            continue;
        }
        let owner = capped
            .iter()
            .find(|name| command_body(source, name).lines().any(|l| l.trim() == line));
        assert!(
            owner.is_some(),
            "an uncapped script argument appeared in commands_auth.rs: `{line}` — \
             add `ensure_script_within_limit` to its command and list it here"
        );
    }
}
