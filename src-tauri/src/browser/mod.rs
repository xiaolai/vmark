//! Embedded browser surface (WI-1.2).
//!
//! VMark owns a raw native webview added as a sibling native view of the Tauri
//! window's content view — deliberately NOT a Tauri-created webview, so Tauri's
//! IPC bridge is never injected into a browsed page (ADR-B2 / R3; the SPIKE-1
//! no-bridge assertion ships as a permanent regression test with the native
//! surface). Only the macOS backend (WKWebView) is implemented today; the
//! Windows (WebView2) and Linux (webkit2gtk) backends are planned (WI-5.1 /
//! WI-5.2) and currently compile to an explicit "unsupported" stub.
//!
//! This module tree:
//!   - `registry` — pure lifecycle + identity core: the tab state machine, the
//!     navigation generation that makes a late driver command stale, and the
//!     committed-origin fact the driver gate reads (R7a). Platform-independent
//!     and unit-tested.
//!   - `origin_guard` — the authoritative origin/grant decision (R4/R5/R7a),
//!     parsed with the same WHATWG parser as the browser's own `URL`.
//!   - `recovery` — the pure crash-budget policy behind auto-reload (WI-1.8).
//!   - `surface` — the `Send` state container plus the command-facing native API;
//!     the macOS objc2 WKWebView implementation (`surface_macos.rs` and its
//!     `#[path]` submodules: nav delegate, run-loop driver, JS dialogs) hangs off
//!     it, and other platforms get an explicit "unsupported" stub.
//!   - `commands` — the Tauri driver commands. Thin coordinators: they own no
//!     lifecycle state of their own (the nav delegate does), and `browser_eval` is
//!     where the origin gate is enforced.
//!
//! Dead code is **enforced on macOS** — the platform where every path is wired,
//! and the platform VMark ships (AGENTS.md). The old blanket
//! `#![allow(dead_code)]` covered the whole subtree on every target, so an orphan
//! in the command or native layer could accumulate unnoticed even though those
//! paths are live; now clippy's `-D warnings` catches it.
//!
//! It stays suppressed on Windows/Linux, and only there: their native surface is
//! an explicit "unsupported" stub until WI-5.1/5.2, so everything only the macOS
//! delegate reaches (the crash budget, generation bumps, committed-URL writes, the
//! no-bridge assertion) is *legitimately* unreachable on those targets — not rot.
//! The handful of items that are unwired on macOS too carry their own item-scoped
//! `#[allow(dead_code)]` with a stated reason.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

pub mod commands;
pub mod commands_auth;
pub mod geometry;
pub mod one_shot;
pub mod operation;
pub mod origin_guard;
pub mod recovery;
pub mod registry;
pub mod surface;
