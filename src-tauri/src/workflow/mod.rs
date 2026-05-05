//! Workflow execution engine.
//!
//! Parses and executes YAML workflow files with step-by-step execution,
//! event emission to the frontend, and built-in action support.

pub mod approval;
pub mod commands;
pub mod expressions;
pub mod genie_step;
pub mod runner;
pub mod sandbox;
pub mod snapshots;
pub mod step_config;
pub mod template;
pub mod types;
