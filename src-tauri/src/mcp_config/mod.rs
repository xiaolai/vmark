//! MCP Configuration Installer
//!
//! Handles installation of MCP configuration for AI providers:
//! - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
//! - Claude Code: ~/.claude.json
//! - Codex CLI: ~/.codex/config.toml
//! - Gemini CLI: ~/.gemini/settings.json

pub mod commands;
mod config_io;
mod providers;
mod types;
