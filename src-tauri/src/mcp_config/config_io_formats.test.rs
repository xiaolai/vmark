//! Tests for `config_io.rs` — per-provider format mapping and the opencode
//! schema (included via `#[path]`; the general content-merging suite lives in
//! `config_io.test.rs`, which is size-frozen).
//!
//! The provider set here is the one the Integrations panel ships: Antigravity
//! replaced Gemini CLI (same `mcpServers` JSON, different file), Grok reads
//! Codex-shaped TOML, and opencode has its own JSON schema — `mcp` key,
//! program-plus-arguments in one `command` array, env vars under
//! `environment`.

use super::*;

const BIN: &str = "/opt/vmark/vmark-mcp-server";
const TOK: &str = "tok-fixture";

// -- format classification is defined once ---------------------------------

#[test]
fn every_shipped_provider_classifies_to_exactly_one_format() {
    for provider in super::super::providers::PROVIDERS {
        let format = config_format(provider.id)
            .unwrap_or_else(|e| panic!("provider {} has no format: {e}", provider.id));
        let expected = match provider.id {
            "codex" | "grok" => ConfigFormat::Toml,
            "opencode" => ConfigFormat::OpenCode,
            _ => ConfigFormat::Json,
        };
        assert_eq!(format, expected, "provider {}", provider.id);
    }
    config_format("nope").expect_err("unknown providers have no format");
}

#[test]
fn each_format_names_its_own_server_map_key() {
    assert_eq!(ConfigFormat::Json.servers_key(), "mcpServers");
    assert_eq!(ConfigFormat::OpenCode.servers_key(), "mcp");
    assert_eq!(ConfigFormat::Toml.servers_key(), "mcp_servers");
}

// -- antigravity and grok reuse the proven machinery ------------------------

#[test]
fn antigravity_writes_the_mcp_servers_json_shape() {
    let out =
        generate_config_content("antigravity", BIN, TOK, None).expect("fresh antigravity install");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);
    assert_eq!(json["mcpServers"]["vmark"]["env"]["VMARK_MCP_TOKEN"], TOK);
}

#[test]
fn grok_writes_the_codex_toml_shape() {
    let existing = "# grok config\n[cli]\nvim_mode = true\n";
    let out = generate_config_content("grok", BIN, TOK, Some(existing)).expect("grok merges");
    assert!(
        out.contains("# grok config"),
        "user comment survives:\n{out}"
    );
    let doc: toml::Table = out.parse().unwrap();
    assert_eq!(doc["cli"]["vim_mode"].as_bool(), Some(true));
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
    assert_eq!(
        doc["mcp_servers"]["vmark"]["env"]["VMARK_MCP_TOKEN"].as_str(),
        Some(TOK)
    );
}

// -- opencode: generate ------------------------------------------------------

#[test]
fn opencode_fresh_install_writes_the_opencode_schema() {
    let out = generate_config_content("opencode", BIN, TOK, None).expect("fresh opencode install");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    let vmark = &json["mcp"]["vmark"];
    assert_eq!(vmark["type"], "local");
    assert_eq!(vmark["command"], serde_json::json!([BIN]));
    assert_eq!(vmark["enabled"], true);
    assert_eq!(vmark["environment"]["VMARK_MCP_TOKEN"], TOK);
    assert!(
        json.get("mcpServers").is_none(),
        "opencode must not receive the mcpServers spelling:\n{out}"
    );
}

#[test]
fn opencode_install_preserves_unrelated_config() {
    let existing = r#"{
      "$schema": "https://opencode.ai/config.json",
      "provider": { "anthropic": { "options": { "timeout": 9000 } } },
      "model": "anthropic/claude-fable-5",
      "mcp": { "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" } }
    }"#;
    let out =
        generate_config_content("opencode", BIN, TOK, Some(existing)).expect("opencode merges");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();

    assert_eq!(json["$schema"], "https://opencode.ai/config.json");
    assert_eq!(json["model"], "anthropic/claude-fable-5");
    assert_eq!(
        json["provider"]["anthropic"]["options"]["timeout"], 9000,
        "provider settings must survive"
    );
    assert_eq!(
        json["mcp"]["context7"]["url"],
        "https://mcp.context7.com/mcp"
    );
    assert_eq!(json["mcp"]["vmark"]["command"], serde_json::json!([BIN]));
}

#[test]
fn opencode_malformed_json_is_rejected() {
    let err = generate_config_content("opencode", BIN, TOK, Some("// jsonc comment\n{}"))
        .expect_err("JSONC is not JSON; refusing beats guessing");
    assert!(err.contains("Invalid JSON"), "unexpected: {err}");
}

#[test]
fn opencode_non_object_mcp_key_is_rejected() {
    let err = generate_config_content("opencode", BIN, TOK, Some(r#"{"mcp": []}"#))
        .expect_err("a non-object mcp cannot receive the vmark entry");
    assert!(err.contains("mcp is not an object"), "unexpected: {err}");
}

// -- opencode: read back -----------------------------------------------------

#[test]
fn opencode_binary_path_is_read_from_the_command_arrays_first_element() {
    let installed = generate_config_content("opencode", BIN, TOK, None).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("opencode.json");
    std::fs::write(&path, &installed).unwrap();

    match read_existing_config(&path, "opencode").expect("valid JSON parses") {
        ExistingConfig::Parsed {
            has_vmark,
            binary_path,
        } => {
            assert!(has_vmark);
            assert_eq!(binary_path.as_deref(), Some(BIN));
        }
        other => panic!("expected Parsed, got {other:?}"),
    }
}

#[test]
fn opencode_client_token_is_read_from_environment() {
    let installed = generate_config_content("opencode", BIN, TOK, None).unwrap();
    assert_eq!(
        client_token_in("opencode", Some(&installed)).expect("parses"),
        Some(TOK.to_string())
    );
}

#[test]
fn opencode_install_is_idempotent() {
    let once = generate_config_content("opencode", BIN, TOK, None).unwrap();
    let twice = generate_config_content("opencode", BIN, TOK, Some(&once)).unwrap();
    assert_eq!(once, twice, "a repeat install must not churn the file");
}

// -- opencode: remove --------------------------------------------------------

#[test]
fn opencode_uninstall_removes_only_the_vmark_entry() {
    let existing = r#"{
      "model": "anthropic/claude-fable-5",
      "mcp": {
        "vmark": { "type": "local", "command": ["/opt/vmark/vmark-mcp-server"] },
        "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" }
      }
    }"#;
    let out = remove_vmark_from_config("opencode", existing)
        .unwrap()
        .expect("vmark was present, so the document changed");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(json["model"], "anthropic/claude-fable-5");
    assert!(json["mcp"]["context7"].is_object());
    assert!(json["mcp"].get("vmark").is_none());
}

#[test]
fn opencode_uninstall_reports_nothing_to_remove() {
    assert_eq!(
        remove_vmark_from_config("opencode", r#"{"mcp": {"other": {}}}"#).unwrap(),
        None
    );
}
