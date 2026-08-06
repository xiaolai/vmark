//! The `vmark` server entry in opencode's schema (`opencode.json`, `mcp` key).
//!
//! opencode's MCP schema differs from the `mcpServers` one in three ways:
//! `command` is a single array holding the program and its arguments, env vars
//! live under `environment`, and entries carry `type`/`enabled` fields. The
//! ownership rule is the same as `vmark_entry.rs`: rewrite only what VMark
//! owns, leave every other byte of the entry to the user.
//!
//! What VMark owns here:
//! - `type` — always `"local"`; the sidecar is a stdio process, never remote.
//! - `command[0]` — the sidecar binary path. Later elements are user-added
//!   arguments and survive a repair.
//! - `environment.VMARK_MCP_TOKEN` — the per-client credential
//!   (`client_token_field.rs` writes only that one key).
//! - `enabled: true`, but only when the key is ABSENT — written on create so
//!   the entry states what it does (opencode checks `enabled === false`, so an
//!   absent key already means enabled), while a user's deliberate `false` is a
//!   setting, and Repair must not flip it back.

use super::client_token_field;
use serde_json::{json, Map, Value as JsonValue};

pub(crate) fn upsert_opencode_vmark(
    servers: &mut Map<String, JsonValue>,
    binary_path: &str,
    client_token: &str,
) -> Result<(), String> {
    let entry = servers
        .entry("vmark")
        .or_insert_with(|| JsonValue::Object(Map::new()));
    let entry = entry.as_object_mut().ok_or_else(|| {
        rust_i18n::t!("errors.mcp.vmarkEntryNotObject", key = "mcp.vmark").to_string()
    })?;

    entry.insert("type".to_string(), JsonValue::String("local".to_string()));

    match entry.get_mut("command") {
        Some(JsonValue::Array(command)) if !command.is_empty() => {
            command[0] = JsonValue::String(binary_path.to_string());
        }
        _ => {
            entry.insert("command".to_string(), json!([binary_path]));
        }
    }

    if !entry.contains_key("enabled") {
        entry.insert("enabled".to_string(), JsonValue::Bool(true));
    }

    client_token_field::write_json_under(
        entry,
        "environment",
        "mcp.vmark.environment",
        client_token,
    )
}

#[cfg(test)]
#[path = "opencode_entry.test.rs"]
mod tests;
