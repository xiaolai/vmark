//! Workflow execution engine.
//!
//! Parses and executes YAML workflow files with step-by-step execution,
//! event emission to the frontend, and built-in action support.

pub(crate) mod actions;
pub mod approval;
pub mod coherence_capture;
pub mod commands;
pub mod condition;
mod condition_lexer;
#[cfg(test)]
mod examples;
pub mod expressions;
pub mod genie_step;
mod guards;
pub mod runner;
pub mod sandbox;
pub mod snapshots;
pub mod state;
pub mod step_config;
pub mod template;
pub mod types;
pub mod untrusted;
