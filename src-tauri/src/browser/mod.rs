//! Embedded browser surface (WI-1.2).
//!
//! VMark owns a raw native webview (WKWebView on macOS, WebView2 on Windows,
//! webkit2gtk on Linux) added as a sibling native view of the Tauri window's
//! content view — deliberately NOT a Tauri-created webview, so Tauri's IPC
//! bridge is never injected into a browsed page (ADR-B2 / R3; the SPIKE-1
//! no-bridge assertion ships as a permanent regression test with the native
//! surface).
//!
//! This module tree:
//!   - `registry` — pure lifecycle + identity core (state machine, navigation
//!     generation, URL validation); platform-independent and unit-tested.
//!   - (native surface, config, and Tauri commands land with the FFI layer,
//!     which is verified in the live-Tauri loop; the validated objc2 recipe is
//!     preserved in git at commit cd162e02:src-tauri/src/spike_embed.rs.)

// Some pure-core items are reached only from tests until every command path
// wires them up; dead_code does not count test usage.
#![allow(dead_code)]

pub mod commands;
pub mod origin_guard;
pub mod recovery;
pub mod registry;
pub mod surface;
