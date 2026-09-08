//! Workflow execution engine.
//!
//! Parses and executes YAML workflow files with step-by-step execution,
//! event emission to the frontend, and built-in action support.

pub(crate) mod actions;
mod actions_folder;
pub mod approval;
pub mod coherence_capture;
pub mod commands;
mod commit;
#[cfg(unix)]
mod commit_dir;
pub mod condition;
mod condition_lexer;
#[cfg(unix)]
mod dir_fd;
mod ensure_dir;
#[cfg(test)]
mod examples;
pub mod expressions;
pub mod genie_step;
mod guards;
mod launch;
mod prepare;
mod recent_ids;
pub mod runner;
pub mod sandbox;
mod snapshot_copy;
mod snapshot_restore;
pub mod snapshots;
pub mod state;
pub mod step_config;
pub mod template;
pub mod types;
pub mod untrusted;
mod validate;
