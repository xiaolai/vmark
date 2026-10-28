//! Git export of one document's edit journal to the branch
//! `vmark-journal/<document-uuid>` of a repository the user picks.
//!
//! One commit per retained revision with attribution trailers, one
//! synthetic commit per run of collected revisions, built with plumbing so
//! the repository's working tree, index and `HEAD` stay untouched. The ref
//! moves only by compare-and-swap; a branch that moved, was rewritten, is
//! checked out, is symbolic or is unrelated is refused rather than
//! overwritten. A re-export appends only the revisions the branch does not
//! cover yet, also after the journal's collector ran.
//!
//! - `names` — branch, file name, identities, single-line trailer values.
//! - `plan`, `branch` — the chain to export and what the branch covers (pure).
//! - `git`, `refs` — the isolated `git` child and the read-only ref queries;
//!   `stdin_feed` feeds that child its stdin from a writer thread.
//! - `state` — the durable record of the tip VMark last wrote.
//! - `export` — the run; `command` — the Tauri entry point.
//!
//! @module agent_journal/git_export

pub mod branch;
pub mod command;
pub mod error;
pub mod export;
pub mod git;
pub mod names;
pub mod plan;
pub mod refs;
pub mod state;
mod stdin_feed;

#[cfg(test)]
#[path = "names.test.rs"]
mod names_tests;

#[cfg(test)]
#[path = "plan.test.rs"]
mod plan_tests;

#[cfg(test)]
#[path = "branch.test.rs"]
mod branch_tests;

#[cfg(test)]
#[path = "export.test.rs"]
mod export_tests;

#[cfg(test)]
#[path = "export_guards.test.rs"]
mod export_guards_tests;

#[cfg(test)]
#[path = "export_races.test.rs"]
mod export_races_tests;

#[cfg(test)]
#[path = "git_open.test.rs"]
mod git_open_tests;
