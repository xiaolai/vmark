//! GitHub Actions workflow viewer support.
//!
//! Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md
//!
//! Currently houses the optional `actionlint` integration (WI-5.3 / WI-5.4).
//! Future phases (Phase 6) will add `gha_fetch_action_yml` here too.

pub mod actionlint;
pub mod commands;
