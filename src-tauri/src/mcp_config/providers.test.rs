//! Binary-path shape for the MCP config writers (#1202).
//!
//! `get_mcp_binary_path` runs `canonicalize()`, which on Windows returns an
//! extended-length VERBATIM path (`\\?\C:\…`). That string is not an internal
//! detail: it is written verbatim into the `command` field of Claude's, Codex's
//! and Gemini's config files, and into the `ccswitch://v1/import` payload. The
//! reporter's link carried `\\?\C:\SEC\VMark\vmark-mcp-server.exe`.
//!
//! Third-party consumers do not recognise the prefix — the same reason
//! `workspace_validation` already strips it before handing a path to the
//! frontend. These pin the stripping rather than the (untestable here)
//! canonicalize call, so the rule holds on every platform's CI.

use super::*;

#[test]
fn strips_a_windows_verbatim_drive_prefix() {
    assert_eq!(
        display_path(r"\\?\C:\SEC\VMark\vmark-mcp-server.exe"),
        r"C:\SEC\VMark\vmark-mcp-server.exe"
    );
}

#[test]
fn rewrites_a_verbatim_unc_prefix_back_to_a_plain_unc_path() {
    // `\\?\UNC\server\share\x` is the verbatim spelling of `\\server\share\x`;
    // stripping only the `\\?\` would yield `UNC\server\share\x`, a relative
    // path pointing nowhere.
    assert_eq!(
        display_path(r"\\?\UNC\server\share\vmark-mcp-server.exe"),
        r"\\server\share\vmark-mcp-server.exe"
    );
}

#[test]
fn leaves_an_ordinary_windows_path_untouched() {
    assert_eq!(
        display_path(r"C:\Program Files\VMark\vmark-mcp-server.exe"),
        r"C:\Program Files\VMark\vmark-mcp-server.exe"
    );
}

#[test]
fn leaves_a_unix_path_untouched() {
    assert_eq!(
        display_path("/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"),
        "/Applications/VMark.app/Contents/MacOS/vmark-mcp-server"
    );
}

#[test]
fn leaves_a_plain_unc_path_untouched() {
    assert_eq!(
        display_path(r"\\server\share\vmark-mcp-server.exe"),
        r"\\server\share\vmark-mcp-server.exe"
    );
}

#[test]
fn does_not_strip_a_prefix_that_merely_appears_mid_path() {
    // Only a LEADING prefix is a verbatim marker.
    assert_eq!(display_path(r"C:\odd\\?\name.exe"), r"C:\odd\\?\name.exe");
}

#[test]
fn is_idempotent() {
    let once = display_path(r"\\?\C:\VMark\vmark-mcp-server.exe");
    assert_eq!(display_path(&once), once);
}

#[test]
fn handles_an_empty_string() {
    assert_eq!(display_path(""), "");
}

#[test]
fn the_resolved_binary_path_is_never_verbatim() {
    // The property that actually matters, asserted against whatever this
    // platform resolves. In dev/CI the binary may be absent, in which case the
    // resolution errors — an error carries no path, so there is nothing to
    // check and nothing to wrongly pass.
    if let Ok(path) = get_mcp_binary_path() {
        assert!(
            !path.starts_with(r"\\?\"),
            "resolved binary path leaked a verbatim prefix: {path}"
        );
    }
}
