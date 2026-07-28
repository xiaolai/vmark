//! Tests for `client_token_field.rs` — the `env.VMARK_MCP_TOKEN` field.

use super::*;
use toml_edit::DocumentMut;

// --- what counts as a credential ------------------------------------------

#[test]
fn a_real_token_is_usable() {
    assert_eq!(usable(Some("abc123")), Some("abc123".to_string()));
}

#[test]
fn surrounding_whitespace_is_trimmed() {
    assert_eq!(usable(Some("  abc123\n")), Some("abc123".to_string()));
}

/// An empty or whitespace-only value is "no credential", never "a credential
/// that is empty" — an empty token must not authenticate anything.
#[test]
fn blank_values_are_not_credentials() {
    assert_eq!(usable(None), None);
    assert_eq!(usable(Some("")), None);
    assert_eq!(usable(Some("   ")), None);
}

/// A user who hand-copies the install preview into their config gets the
/// literal placeholder. Two users doing that would otherwise SHARE a
/// credential — the exact ambiguity the principal mechanism must not have.
#[test]
fn the_preview_placeholder_is_not_a_credential() {
    assert_eq!(usable(Some(TOKEN_PLACEHOLDER)), None);
}

// --- JSON -----------------------------------------------------------------

#[test]
fn json_round_trips_a_written_token() {
    let mut entry = Map::new();
    write_json(&mut entry, "tok-json").expect("write");
    let value = JsonValue::Object(entry);
    assert_eq!(read_json(&value), Some("tok-json".to_string()));
}

/// The user's own `env` keys are theirs. Replacing the object wholesale is
/// the bug `vmark_entry.rs` exists to prevent, one level deeper.
#[test]
fn json_write_preserves_user_env_keys() {
    let mut entry: Map<String, JsonValue> = serde_json::from_value(serde_json::json!({
        "command": "/old/vmark-mcp-server",
        "env": { "HTTPS_PROXY": "http://proxy:8080", "NODE_OPTIONS": "--max-old-space-size=4096" }
    }))
    .expect("entry");

    write_json(&mut entry, "tok-json").expect("write");

    let env = entry["env"].as_object().expect("env object");
    assert_eq!(env["HTTPS_PROXY"], "http://proxy:8080");
    assert_eq!(env["NODE_OPTIONS"], "--max-old-space-size=4096");
    assert_eq!(env[TOKEN_ENV_KEY], "tok-json");
}

#[test]
fn json_write_overwrites_only_our_key() {
    let mut entry: Map<String, JsonValue> = serde_json::from_value(serde_json::json!({
        "env": { "VMARK_MCP_TOKEN": "stale", "KEEP": "me" }
    }))
    .expect("entry");

    write_json(&mut entry, "fresh").expect("write");

    assert_eq!(entry["env"]["VMARK_MCP_TOKEN"], "fresh");
    assert_eq!(entry["env"]["KEEP"], "me");
}

/// `env` set to a non-object is the user's data in a shape we cannot merge
/// into. Refusing is symmetric with `mcpServers is not an object`; silently
/// replacing it would destroy whatever they meant by it.
#[test]
fn json_write_refuses_a_non_object_env() {
    let mut entry: Map<String, JsonValue> =
        serde_json::from_value(serde_json::json!({ "env": "not-an-object" })).expect("entry");
    let err = write_json(&mut entry, "tok").expect_err("must refuse");
    assert!(err.contains("env"), "{err}");
}

#[test]
fn json_read_of_an_entry_without_env_is_none() {
    let value = serde_json::json!({ "command": "/bin/vmark-mcp-server" });
    assert_eq!(read_json(&value), None);
}

// --- TOML -----------------------------------------------------------------

fn toml_entry(text: &str) -> DocumentMut {
    text.parse::<DocumentMut>().expect("parse")
}

#[test]
fn toml_round_trips_a_written_token() {
    let mut doc = toml_entry("[mcp_servers.vmark]\ncommand = \"/bin/x\"\n");
    let entry = doc["mcp_servers"]["vmark"]
        .as_table_like_mut()
        .expect("entry");
    write_toml(entry, TomlEntryStyle::Standard, "tok-toml").expect("write");

    let rendered = doc.to_string();
    assert!(rendered.contains("VMARK_MCP_TOKEN"), "{rendered}");
    assert_eq!(
        read_toml(&doc["mcp_servers"]["vmark"]),
        Some("tok-toml".to_string())
    );
}

#[test]
fn toml_write_preserves_user_env_keys_and_comments() {
    let mut doc = toml_entry(
        "[mcp_servers.vmark]\ncommand = \"/bin/x\"\n\n[mcp_servers.vmark.env]\n# keep me\nHTTPS_PROXY = \"http://proxy:8080\"\n",
    );
    let entry = doc["mcp_servers"]["vmark"]
        .as_table_like_mut()
        .expect("entry");
    write_toml(entry, TomlEntryStyle::Standard, "tok-toml").expect("write");

    let rendered = doc.to_string();
    assert!(rendered.contains("# keep me"), "{rendered}");
    assert!(
        rendered.contains("HTTPS_PROXY = \"http://proxy:8080\""),
        "{rendered}"
    );
    assert!(
        rendered.contains("VMARK_MCP_TOKEN = \"tok-toml\""),
        "{rendered}"
    );
}

/// An inline `vmark = { … }` entry must get an INLINE `env`. A standard
/// `Item::Table` inserted into an `InlineTable` does not merely render invalid
/// TOML — `TableLike::insert` unwraps `Item::into_value` and panics.
#[test]
fn toml_inline_entry_gets_an_inline_env_table() {
    let mut doc = toml_entry("[mcp_servers]\nvmark = { command = \"/bin/x\" }\n");
    let entry = doc["mcp_servers"]["vmark"]
        .as_table_like_mut()
        .expect("entry");
    write_toml(entry, TomlEntryStyle::Inline, "tok-inline").expect("write");

    let rendered = doc.to_string();
    assert!(rendered.contains("env = {"), "{rendered}");
    assert!(
        rendered.parse::<DocumentMut>().is_ok(),
        "still valid TOML: {rendered}"
    );
    assert_eq!(
        read_toml(&doc["mcp_servers"]["vmark"]),
        Some("tok-inline".to_string())
    );
}

#[test]
fn toml_write_refuses_a_non_table_env() {
    let mut doc = toml_entry("[mcp_servers.vmark]\ncommand = \"/bin/x\"\nenv = \"nope\"\n");
    let entry = doc["mcp_servers"]["vmark"]
        .as_table_like_mut()
        .expect("entry");
    let err = write_toml(entry, TomlEntryStyle::Standard, "tok").expect_err("must refuse");
    assert!(err.contains("env"), "{err}");
}

#[test]
fn toml_read_of_an_entry_without_env_is_none() {
    let doc = toml_entry("[mcp_servers.vmark]\ncommand = \"/bin/x\"\n");
    assert_eq!(read_toml(&doc["mcp_servers"]["vmark"]), None);
}
