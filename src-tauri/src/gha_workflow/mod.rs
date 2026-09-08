//! GitHub Actions workflow viewer support.
//!
//! Origin: GitHub Actions workflow viewer plan (2026-05-04, retired)
//!
//! Houses the Rust-side surface for the GHA workflow viewer:
//! - actionlint: optional shell-out to the actionlint binary (WI-5.3/5.4)
//! - action_fetch: action.yml fetcher with on-disk cache (WI-6.3)

pub mod action_fetch;
pub mod actionlint;
pub mod commands;
