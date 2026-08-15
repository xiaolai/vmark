//! Trusted HTML preview — an opt-in, origin-isolated execution mode for
//! standalone `.html` / `.htm` documents (issue #1273).
//!
//! The default preview stays what it was: DOMPurify, an empty `sandbox`, and a
//! `default-src 'none'` meta CSP (ADR-4, `lib/formats/adapters/html.tsx`).
//! Nothing here changes it. This module is the surface a user can *explicitly*
//! authorize a document into, one file at a time, for one session.
//!
//! | Concern | Where |
//! |---|---|
//! | What is authorized, and its token | `state` |
//! | Serving it under its own CSP | `protocol` |
//! | Moving the user's decision across IPC | `commands` |
//!
//! **Trust is never inferred.** No path, extension, or file origin reaches this
//! module — a grant exists only because `trusted_html_grant` was called from a
//! confirmed user action, and nothing else can create one.
//!
//! Nothing is persisted: grants live in memory and die with the process, so a
//! document trusted today is untrusted the next time VMark starts.
//!
//! **Lifetime, precisely.** A grant ends in exactly two ways: the user revokes
//! it, or the process exits. That is the whole list.
//!
//! An earlier version of this note also claimed revocation on preview unmount
//! and on `beforeunload`. Neither was ever implemented — the claim outlived a
//! decision not to build them, which is the failure mode this repository's
//! documentation rules exist to prevent, so it is recorded here rather than
//! quietly deleted.
//!
//! There is deliberately no quit-time hook: quit goes through
//! `std::process::exit`, and this registry holds no child process, socket or
//! file, so a teardown call there would be a no-op wearing the costume of a
//! safeguard (`quit::shutdown_child_process_subsystems` is for things that
//! genuinely outlive the app).
//!
//! **Known bound, accepted deliberately.** A webview destroyed while the
//! process lives leaves that window's grants resident until quit. They are
//! unreachable — the only frame that knew the token is gone, the token is 32
//! bytes of CSPRNG entropy, and `MAX_GRANTS` bounds the total — so this is a
//! memory cost, not an access-control hole. Closing it properly means keying
//! grants by window label and revoking from `WindowEvent::Destroyed`; a
//! process-global sweep is NOT the fix, because one window's teardown would
//! then revoke every other window's trusted previews.

pub mod commands;
pub mod protocol;
pub mod state;

/// Version pin for the IPC boundary `protocol.rs` documents. Tests only — it
/// exists so a Tauri bump cannot silently remove the single layer that stops a
/// sandboxed trusted document invoking commands.
#[cfg(test)]
#[path = "tauri_pin.test.rs"]
mod tauri_pin_tests;

pub use state::TrustedHtmlState;
