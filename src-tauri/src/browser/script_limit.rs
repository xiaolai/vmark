//! The server-side bound on caller-supplied script/CSS text (audit 2026-07-28).
//!
//! The same 64 KiB number lives in two CLIENT-side places —
//! `server/mcp/src/tools/browser.ts` (the MCP sidecar) and
//! `src/hooks/mcpBridge/v2/browserPower.ts` (the webview handler) — and both
//! measure it in UTF-8 bytes. Those two are **advisory**: they sit ABOVE the
//! Tauri command boundary, so anything that invokes a browser command directly
//! (a compromised webview, a bug in the bridge dispatch, a future caller that
//! forgets the check) never passes through them. **This copy is the
//! authoritative gate** — the only one below the boundary, and the only one an
//! attacker cannot route around.
//!
//! Three copies of one number is a known hazard in this repo (rule 60 §10:
//! mutually-masked divergence). There is no constant surface shared by the Rust
//! crate, the React app, and the npm sidecar, so the duplication is structural
//! rather than accidental — recorded here instead of silently added. Changing
//! the limit means changing all three; only this one changes what the app
//! actually enforces.
//!
//! @coordinates-with browser/commands_auth.rs — the command entry points that call this
//! @coordinates-with server/mcp/src/tools/browser.ts — advisory client-side mirror
//! @coordinates-with src/hooks/mcpBridge/v2/browserPower.ts — advisory client-side mirror

/// 64 KiB, measured in UTF-8 **bytes**.
///
/// `str::len()` on a Rust `&str`/`String` is already the UTF-8 byte count — the
/// length of the encoded form, not the character count — so the naive length is
/// the correct measure here. That is not true of the client-side mirrors: JS
/// `.length` is UTF-16 code units, which is why both of them had to encode
/// explicitly to agree with this number. (Pinned by `rust_str_len_is_utf8_bytes_not_chars`.)
pub(crate) const MAX_SCRIPT_BYTES: usize = 64 * 1024;

/// Refuse `script` if it exceeds [`MAX_SCRIPT_BYTES`].
///
/// `what` names the offending argument (`"script"`, `"one-shot eval_script"`) so a
/// command with several text arguments says which one tripped.
///
/// This is a **size bound and nothing else**: it is orthogonal to authorization,
/// makes no judgement about content, and accepts empty input unchanged — emptiness
/// is the client's business and refusing it here would quietly turn a resource
/// bound into a content check. The comparison is `>`, not `>=`, matching both
/// client-side mirrors, so a payload the sidecar admits is not refused here.
pub(crate) fn ensure_script_within_limit(what: &str, script: &str) -> Result<(), String> {
    let bytes = script.len();
    if bytes > MAX_SCRIPT_BYTES {
        return Err(format!(
            "{what} exceeds the {MAX_SCRIPT_BYTES}-byte limit ({bytes} bytes)"
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "script_limit.test.rs"]
mod tests;
