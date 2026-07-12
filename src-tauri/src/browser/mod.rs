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

// The pure core is complete and unit-tested but its production consumers (the
// native surface + Tauri commands) land with the FFI layer — until then its
// public items are only reached from tests, which dead_code does not count.
#![allow(dead_code)]

pub mod registry;
