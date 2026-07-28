//! MCP Configuration Installer
//!
//! Handles installation of MCP configuration for AI providers:
//! - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
//! - Claude Code: ~/.claude.json
//! - Codex CLI: ~/.codex/config.toml
//! - Gemini CLI: ~/.gemini/settings.json

mod backup_io;
pub(crate) mod client_token_field;
pub(crate) mod client_tokens;
pub mod commands;
mod config_io;
mod create_io;
mod install_io;
mod parsed_config;
mod providers;
mod types;
mod vmark_entry;
