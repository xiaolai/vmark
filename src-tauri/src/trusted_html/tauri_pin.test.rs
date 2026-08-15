//! Pin the Tauri version the trusted-preview IPC boundary was verified against.
//!
//! Trusted HTML preview runs attacker-shaped content in a frame that CAN reach
//! `window.webkit.messageHandlers`. Exactly one thing stops it invoking Tauri
//! commands: the frame never receives `__TAURI_INVOKE_KEY__`, because the
//! invoke bootstrap is injected `for_main_frame_only: true`.
//!
//! Both halves are Tauri INTERNALS, not documented API:
//!
//! - `manager/webview.rs` injecting the bootstrap main-frame-only, and
//! - `Webview::on_message` refusing a request whose key does not match.
//!
//! Neither is something Tauri promises to keep. A minor bump could change
//! either, and nothing else in this repository would notice — the frontend
//! tests would stay green, the Rust tests would stay green, and the only
//! symptom would be that a trusted document could suddenly call every command
//! the app exposes.
//!
//! So this test fails on a version change. It is not claiming the new version
//! is broken; it is refusing to let the claim in `protocol.rs` go stale
//! silently. To clear it: re-run the boundary check below, then update
//! `VERIFIED_TAURI`.
//!
//! **Re-verification procedure** (~10 minutes, needs `pnpm tauri:dev`):
//!
//! 1. Open any `.html` file with Formats → HTML preview enabled.
//! 2. Enable trusted preview, and confirm the frame is
//!    `sandbox="allow-scripts"` with `src=vmark-trusted://…`.
//! 3. From inside the document, post a Tauri IPC message with NO key:
//!    `window.webkit.messageHandlers.ipc.postMessage(JSON.stringify({cmd:
//!    "window_close_log", callback: 1, error: 2, payload: {message: "PROBE"},
//!    options: {}}))`. The Rust log must show
//!    `missing field __TAURI_INVOKE_KEY__` and must NOT show `PROBE`.
//! 4. Confirm the frame still cannot read the key: `window.parent.document`
//!    and `window.__TAURI_INTERNALS__` must both be unreachable from it.
//!
//! Step 4 is the one that matters most. Step 3 passing while step 4 regressed
//! would mean the gate is intact but the secret behind it is not.
//!
//! @coordinates-with protocol.rs — the module doc this keeps honest

use std::path::Path;

/// The tauri version the boundary above was measured against.
const VERIFIED_TAURI: &str = "2.11.5";

/// Read the resolved `tauri` version out of the lockfile.
fn locked_tauri_version() -> String {
    let lock = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock");
    let text = std::fs::read_to_string(&lock).expect("src-tauri/Cargo.lock is readable");

    let mut in_tauri = false;
    for line in text.lines() {
        let line = line.trim();
        if line == "[[package]]" {
            in_tauri = false;
        } else if line == "name = \"tauri\"" {
            in_tauri = true;
        } else if in_tauri {
            if let Some(rest) = line.strip_prefix("version = \"") {
                if let Some(v) = rest.strip_suffix('"') {
                    return v.to_string();
                }
            }
        }
    }
    panic!("no `tauri` package found in src-tauri/Cargo.lock");
}

#[test]
fn trusted_html_ipc_boundary_was_verified_against_this_tauri() {
    let locked = locked_tauri_version();
    assert_eq!(
        locked, VERIFIED_TAURI,
        "\n\ntauri moved {VERIFIED_TAURI} -> {locked}.\n\n\
         Trusted HTML preview's ONLY defence against a sandboxed document \
         invoking Tauri commands is that the frame never receives \
         __TAURI_INVOKE_KEY__ (bootstrap injected for_main_frame_only). That \
         is a Tauri internal, not documented API, so a version change can \
         remove it without any test here going red.\n\n\
         Re-run the procedure in the header of this file, then update \
         VERIFIED_TAURI. Do not just bump the constant.\n"
    );
}

/// The pin is worthless if it reads the wrong thing, so prove the parser finds
/// a plausible version rather than silently returning a default.
#[test]
fn the_pin_actually_reads_a_version_from_the_lockfile() {
    let locked = locked_tauri_version();
    assert!(
        locked.starts_with("2."),
        "expected a tauri 2.x version, parsed {locked:?} — the lockfile format changed"
    );
}
