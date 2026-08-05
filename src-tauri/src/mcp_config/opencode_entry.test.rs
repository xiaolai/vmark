//! Tests for `opencode_entry.rs` (included via `#[path]`).
//!
//! opencode's entry schema differs from the `mcpServers` one, so what VMark
//! owns differs too: `type`, `command[0]`, and `environment.VMARK_MCP_TOKEN`.
//! Everything else on the entry — extra command arguments, other environment
//! variables, a deliberate `enabled: false` — is the user's.

use super::*;
use serde_json::{json, Map, Value as JsonValue};

const BIN: &str = "/opt/vmark/vmark-mcp-server";
const TOK: &str = "tok-fixture";

fn servers_from(value: JsonValue) -> Map<String, JsonValue> {
    value.as_object().expect("fixture is an object").clone()
}

fn upsert(mut servers: Map<String, JsonValue>) -> Map<String, JsonValue> {
    upsert_opencode_vmark(&mut servers, BIN, TOK).expect("upsert succeeds");
    servers
}

#[test]
fn a_fresh_entry_has_the_full_opencode_shape() {
    let servers = upsert(Map::new());
    let entry = &servers["vmark"];

    assert_eq!(entry["type"], "local");
    assert_eq!(entry["command"], json!([BIN]));
    assert_eq!(entry["enabled"], true, "a fresh entry states its own state");
    assert_eq!(entry["environment"]["VMARK_MCP_TOKEN"], TOK);
}

#[test]
fn user_added_command_arguments_survive_a_repair() {
    // opencode's `command` is program-plus-arguments in one array; only the
    // first element is VMark's.
    let servers = upsert(servers_from(json!({
        "vmark": { "command": ["/stale/vmark-mcp-server", "--log-level", "debug"] }
    })));
    assert_eq!(
        servers["vmark"]["command"],
        json!([BIN, "--log-level", "debug"])
    );
}

#[test]
fn a_deliberate_enabled_false_is_not_flipped_back() {
    let servers = upsert(servers_from(json!({
        "vmark": { "command": [BIN], "enabled": false }
    })));
    assert_eq!(servers["vmark"]["enabled"], false);
}

#[test]
fn user_environment_variables_survive() {
    let servers = upsert(servers_from(json!({
        "vmark": { "environment": { "HTTPS_PROXY": "http://127.0.0.1:7890" } }
    })));
    let environment = &servers["vmark"]["environment"];
    assert_eq!(environment["HTTPS_PROXY"], "http://127.0.0.1:7890");
    assert_eq!(environment["VMARK_MCP_TOKEN"], TOK);
}

#[test]
fn a_non_array_command_is_repaired_to_the_canonical_one() {
    // A string `command` is invalid in opencode's schema; install replaces it
    // rather than crashing or appending to it.
    let servers = upsert(servers_from(json!({
        "vmark": { "command": "/stale/vmark-mcp-server" }
    })));
    assert_eq!(servers["vmark"]["command"], json!([BIN]));
}

#[test]
fn an_empty_command_array_is_repaired_to_the_canonical_one() {
    let servers = upsert(servers_from(json!({ "vmark": { "command": [] } })));
    assert_eq!(servers["vmark"]["command"], json!([BIN]));
}

#[test]
fn a_stale_type_is_rewritten_to_local() {
    // `type` is VMark's: the sidecar is a local stdio process, never remote.
    let servers = upsert(servers_from(json!({
        "vmark": { "type": "remote", "command": [BIN] }
    })));
    assert_eq!(servers["vmark"]["type"], "local");
}

#[test]
fn other_server_entries_are_untouched() {
    let servers = upsert(servers_from(json!({
        "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" }
    })));
    assert_eq!(
        servers["context7"],
        json!({ "type": "remote", "url": "https://mcp.context7.com/mcp" })
    );
    assert!(servers.contains_key("vmark"));
}

#[test]
fn a_non_object_vmark_entry_is_an_error() {
    let mut servers = servers_from(json!({ "vmark": "oops" }));
    let err = upsert_opencode_vmark(&mut servers, BIN, TOK)
        .expect_err("a scalar vmark entry cannot be upserted");
    assert!(err.contains("mcp.vmark"), "unexpected error: {err}");
}
