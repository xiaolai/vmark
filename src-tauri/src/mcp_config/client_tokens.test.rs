//! Tests for `client_tokens.rs` — the per-client credential registry.

use super::*;

/// Write a JSON provider config carrying `token` (or none when `None`).
fn json_config(dir: &Path, name: &str, token: Option<&str>) -> PathBuf {
    let path = dir.join(name);
    let entry = match token {
        Some(t) => serde_json::json!({ "command": "/bin/vmark", "env": { "VMARK_MCP_TOKEN": t } }),
        None => serde_json::json!({ "command": "/bin/vmark" }),
    };
    std::fs::write(
        &path,
        serde_json::json!({ "mcpServers": { "vmark": entry } }).to_string(),
    )
    .expect("write config");
    path
}

fn toml_config(dir: &Path, name: &str, token: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(
        &path,
        format!("[mcp_servers.vmark]\ncommand = \"/bin/vmark\"\n\n[mcp_servers.vmark.env]\nVMARK_MCP_TOKEN = \"{token}\"\n"),
    )
    .expect("write config");
    path
}

// --- reading the configured set -------------------------------------------

#[test]
fn each_providers_credential_is_read_from_its_own_config() {
    let td = tempfile::tempdir().expect("tempdir");
    let claude = json_config(td.path(), "claude.json", Some("tok-claude"));
    let codex = toml_config(td.path(), "codex.toml", "tok-codex");

    let tokens = read_tokens_at(&[("claude", claude), ("codex", codex)]);

    assert_eq!(
        tokens,
        vec![
            ProviderToken {
                provider: "claude".into(),
                token: "tok-claude".into()
            },
            ProviderToken {
                provider: "codex".into(),
                token: "tok-codex".into()
            },
        ]
    );
}

/// The migration state: an install that predates this mechanism has a vmark
/// entry with no `env`. That is "not identified", not an error.
#[test]
fn a_config_without_a_credential_contributes_nothing() {
    let td = tempfile::tempdir().expect("tempdir");
    let claude = json_config(td.path(), "claude.json", None);
    assert!(read_tokens_at(&[("claude", claude)]).is_empty());
}

#[test]
fn an_absent_config_contributes_nothing() {
    let td = tempfile::tempdir().expect("tempdir");
    let missing = td.path().join("nope.json");
    assert!(read_tokens_at(&[("claude", missing)]).is_empty());
}

/// THE availability property: a third-party tool leaving a syntax error in
/// `~/.claude.json` must not take the bridge — or the OTHER clients' identities
/// — down with it.
#[test]
fn a_malformed_config_is_skipped_and_the_others_still_load() {
    let td = tempfile::tempdir().expect("tempdir");
    let broken = td.path().join("broken.json");
    std::fs::write(&broken, "{ this is not json").expect("write");
    let codex = toml_config(td.path(), "codex.toml", "tok-codex");

    let tokens = read_tokens_at(&[("claude", broken), ("codex", codex)]);

    assert_eq!(tokens.len(), 1, "the broken config is skipped, not fatal");
    assert_eq!(tokens[0].provider, "codex");
}

/// An unknown provider id is a caller bug, and it is skipped for the same
/// reason a broken file is: nothing about it should stop the bridge.
#[test]
fn an_unknown_provider_is_skipped() {
    let td = tempfile::tempdir().expect("tempdir");
    let path = json_config(td.path(), "x.json", Some("tok"));
    assert!(read_tokens_at(&[("not-a-provider", path)]).is_empty());
}

/// A config that hand-copied the install preview carries the literal
/// placeholder. Two of them would otherwise share a credential.
#[test]
fn a_placeholder_credential_is_not_read_as_one() {
    let td = tempfile::tempdir().expect("tempdir");
    let path = json_config(td.path(), "claude.json", Some(TOKEN_PLACEHOLDER));
    assert!(read_tokens_at(&[("claude", path)]).is_empty());
}

// --- the install policy ----------------------------------------------------

/// Repair must not rotate. A running sidecar holds its credential in its
/// environment; re-issuing on every Repair click would unidentify it.
#[test]
fn policy_preserves_an_existing_credential() {
    let policy = TokenPolicy {
        fresh: "fresh".into(),
        taken: vec![],
    };
    assert_eq!(policy.choose(Some("existing".into())), "existing");
}

#[test]
fn policy_mints_when_none_is_configured() {
    let policy = TokenPolicy {
        fresh: "fresh".into(),
        taken: vec![],
    };
    assert_eq!(policy.choose(None), "fresh");
}

/// The copy-paste case. A credential two providers share names neither, so
/// preserving it would leave both permanently ambiguous — re-issue instead,
/// which is exactly the fix the ambiguity error tells the user to apply.
#[test]
fn policy_reissues_a_credential_another_provider_holds() {
    let policy = TokenPolicy {
        fresh: "fresh".into(),
        taken: vec!["shared".into()],
    };
    assert_eq!(policy.choose(Some("shared".into())), "fresh");
}

#[test]
fn minted_credentials_are_unique_secrets() {
    let a = mint_client_token();
    let b = mint_client_token();
    assert_ne!(a, b);
    assert_eq!(a.len(), 64);
}

// --- the published snapshot ------------------------------------------------

/// `publish`/`snapshot` are process-global; this test owns the whole registry,
/// so it restores what it found rather than leaving a fixture behind.
#[test]
fn published_credentials_are_visible_to_readers() {
    let before = snapshot();
    publish(vec![ProviderToken {
        provider: "codex".into(),
        token: "snapshot-token".into(),
    }]);
    let after = snapshot();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].provider, "codex");
    publish((*before).clone());
}

// --- the preview -----------------------------------------------------------

#[test]
fn preview_shows_the_configured_credential_when_there_is_one() {
    let existing = serde_json::json!({
        "mcpServers": { "vmark": { "command": "/bin/vmark", "env": { "VMARK_MCP_TOKEN": "kept" } } }
    })
    .to_string();
    assert_eq!(preview_token("claude", Some(&existing)), "kept");
}

/// A fresh install mints at install time, so the preview cannot show the real
/// value — showing a *different* random token would be worse than saying so.
#[test]
fn preview_shows_a_placeholder_when_one_will_be_minted() {
    assert_eq!(preview_token("claude", None), TOKEN_PLACEHOLDER);
}

/// A config the preview cannot parse still previews: `generate_config_content`
/// is what refuses it, with the parse error, which is the message the user
/// needs.
#[test]
fn preview_falls_back_to_the_placeholder_on_an_unparseable_config() {
    assert_eq!(
        preview_token("claude", Some("{ not json")),
        TOKEN_PLACEHOLDER
    );
}
