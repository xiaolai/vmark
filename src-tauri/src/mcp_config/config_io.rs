//! Config *content* — reading, generating, and removing MCP entries.
//!
//! Handles the JSON (Claude Desktop, Claude Code, Antigravity), opencode-JSON
//! (`opencode.json`) and TOML (Codex, Grok) config formats for adding/removing
//! the vmark MCP server entry. Filesystem side effects live in `install_io.rs`
//! and `backup_io.rs`; the parsed-document representation lives in
//! `parsed_config.rs`; the vmark entry's own field-level upsert lives in
//! `vmark_entry.rs` (opencode's in `opencode_entry.rs`).
//!
//! Key decision: both formats round-trip **non-destructively** — see
//! `parsed_config.rs`. Only the bytes VMark owns may change.

use super::install_io::read_config_for_merge;
use super::opencode_entry::upsert_opencode_vmark;
use super::parsed_config::{merge_base, parse, Parsed};
use super::vmark_entry::{upsert_json_vmark, upsert_toml_vmark, TomlEntryStyle};
use std::path::Path;
use toml_edit::{DocumentMut, Item as TomlItem, Table as TomlTable};

/// Which on-disk representation a provider's config uses.
///
/// Classified in exactly one place. Four functions previously repeated the
/// `"claude-desktop" | "claude" | "gemini" => JSON, "codex" => TOML` match,
/// which is how one of them could validate differently from the others.
///
/// `OpenCode` is JSON *syntax* with a different schema: the server map lives
/// under `mcp`, an entry's `command` is one array holding the program and its
/// arguments, env vars live under `environment`, and entries carry
/// `type`/`enabled` fields. See `opencode_entry.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigFormat {
    Json,
    OpenCode,
    Toml,
}

impl ConfigFormat {
    /// The key holding the server map. JSON configs camelCase it; TOML ones
    /// snake_case it; opencode shortens it to `mcp`.
    pub(crate) fn servers_key(self) -> &'static str {
        match self {
            ConfigFormat::Json => "mcpServers",
            ConfigFormat::OpenCode => "mcp",
            ConfigFormat::Toml => "mcp_servers",
        }
    }
}

/// Map a provider id to its config format, or reject an unknown provider.
pub(crate) fn config_format(provider_id: &str) -> Result<ConfigFormat, String> {
    match provider_id {
        "claude-desktop" | "claude" | "gemini" | "antigravity" => Ok(ConfigFormat::Json),
        "opencode" => Ok(ConfigFormat::OpenCode),
        "codex" | "grok" => Ok(ConfigFormat::Toml),
        _ => Err(rust_i18n::t!("errors.mcp.unknownProvider", provider = provider_id).to_string()),
    }
}

/// What was found at a provider's config path. Three states, not two.
///
/// Diagnose used to get `(Option<String>, bool)` back, in which a missing file
/// and an unparseable one both produced `has_vmark == false` — which the
/// Integrations panel renders as "not installed". Collapsing "nothing is here"
/// into "I cannot make sense of what is here" is the bug.
#[derive(Debug)]
pub(crate) enum ExistingConfig {
    /// No file at that path.
    Absent,
    /// Read and parsed. `binary_path` is the vmark entry's `command`, taken
    /// from this same parse — the caller no longer re-parses the file to get
    /// it.
    Parsed {
        has_vmark: bool,
        binary_path: Option<String>,
    },
    /// Present, but unreadable (permissions, non-UTF-8) or unparseable.
    /// `detail` is the already-localized reason.
    Unreadable { detail: String },
}

/// Read a provider's config and classify what is there.
///
/// `Err` is reserved for a provider VMark does not know — a caller bug, not a
/// property of the user's file, so it must not masquerade as a broken config.
pub(crate) fn read_existing_config(
    path: &Path,
    provider_id: &str,
) -> Result<ExistingConfig, String> {
    let format = config_format(provider_id)?;
    // Shares the absent-vs-unreadable decision with the install path, rather
    // than keeping a second copy of it that can drift.
    let content = match read_config_for_merge(path) {
        Ok(Some(content)) => content,
        Ok(None) => return Ok(ExistingConfig::Absent),
        Err(detail) => return Ok(ExistingConfig::Unreadable { detail }),
    };
    if merge_base(Some(&content)).is_none() {
        // A blank file is what the install path builds on (see `merge_base`),
        // so it is "present, nothing configured" — not broken.
        return Ok(ExistingConfig::Parsed {
            has_vmark: false,
            binary_path: None,
        });
    }
    match parse(format, &content) {
        Ok(parsed) => {
            let entry = parsed.vmark_entry(format);
            Ok(ExistingConfig::Parsed {
                has_vmark: entry.is_some(),
                binary_path: entry.and_then(|e| e.command().map(str::to_string)),
            })
        }
        Err(detail) => Ok(ExistingConfig::Unreadable { detail }),
    }
}

/// The per-client credential configured for `provider_id`, read from config
/// *content*.
///
/// Content rather than a path because the install path already holds the
/// bytes: `mutate_config_at`'s transform is handed the snapshot it validated,
/// and re-reading the file there would reintroduce the very race that
/// snapshot exists to close.
///
/// `Err` means the config could not be parsed — the caller decides whether
/// that is fatal (install: yes, refuse rather than rewrite the user's file) or
/// merely skippable (bridge startup: yes, one broken third-party config must
/// not stop VMark). `Ok(None)` means "no credential configured", which
/// includes an absent file, an absent vmark entry, an absent `env`, and a
/// blank or placeholder value (see `client_token_field::usable`).
pub(crate) fn client_token_in(
    provider_id: &str,
    content: Option<&str>,
) -> Result<Option<String>, String> {
    let format = config_format(provider_id)?;
    let Some(content) = merge_base(content) else {
        return Ok(None);
    };
    Ok(parse(format, content)?
        .vmark_entry(format)
        .and_then(|entry| entry.client_token()))
}

/// Generate proposed config content for a provider.
///
/// A config we cannot parse is an **error**, never an empty document to build
/// on. `~/.claude.json` holds Claude Code's entire state — projects, history,
/// every other MCP server — so falling back to `{}` on a parse failure would
/// rewrite it as a vmark-only file and destroy all of it. Same for
/// `~/.codex/config.toml`. The uninstall path below has always done this
/// correctly; the install path now matches it.
///
/// The vmark entry itself is **upserted**, not replaced: see `vmark_entry.rs`.
///
/// `client_token` is the per-client credential written to
/// `env.VMARK_MCP_TOKEN`; the caller decides whether to preserve the one
/// already in the file or issue a new one (`client_tokens::TokenPolicy`), and
/// the preview path passes `client_token_field::TOKEN_PLACEHOLDER`.
///
/// Note: No --port argument needed - sidecar auto-discovers port from app data directory
pub(crate) fn generate_config_content(
    provider_id: &str,
    binary_path: &str,
    client_token: &str,
    existing_content: Option<&str>,
) -> Result<String, String> {
    let format = config_format(provider_id)?;
    let key = format.servers_key();

    match format {
        ConfigFormat::Json | ConfigFormat::OpenCode => {
            let mut json: serde_json::Value = match merge_base(existing_content) {
                Some(c) => match parse(format, c)? {
                    Parsed::Json(v) => v,
                    Parsed::Toml(_) => unreachable!("JSON syntax parses to Parsed::Json"),
                },
                None => serde_json::json!({}),
            };

            let servers = json
                .as_object_mut()
                .ok_or_else(|| rust_i18n::t!("errors.mcp.invalidJsonStructure").to_string())?
                .entry(key)
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
                .ok_or_else(|| {
                    rust_i18n::t!("errors.mcp.serversNotObject", key = key).to_string()
                })?;

            match format {
                ConfigFormat::OpenCode => {
                    upsert_opencode_vmark(servers, binary_path, client_token)?
                }
                _ => upsert_json_vmark(servers, binary_path, client_token)?,
            }
            Parsed::Json(json).serialize()
        }
        ConfigFormat::Toml => {
            let mut doc: DocumentMut = match merge_base(existing_content) {
                Some(c) => match parse(format, c)? {
                    Parsed::Toml(t) => t,
                    Parsed::Json(_) => unreachable!("TOML format parses to Parsed::Toml"),
                },
                None => DocumentMut::new(),
            };

            let root = doc.as_table_mut();
            if root.get(key).is_none() {
                let mut created = TomlTable::new();
                // Implicit, so the output is `[mcp_servers.vmark]` rather than
                // a bare `[mcp_servers]` header the user never asked for.
                created.set_implicit(true);
                root.insert(key, TomlItem::Table(created));
            }
            let servers_item = root.get_mut(key).expect("just ensured present");
            let style = TomlEntryStyle::of_parent(servers_item);

            // Symmetric with the JSON path's "mcpServers is not an object".
            // Skipping the insert silently would report a successful install
            // with vmark absent from the config.
            let servers = servers_item
                .as_table_like_mut()
                .ok_or_else(|| rust_i18n::t!("errors.mcp.serversNotTable").to_string())?;

            upsert_toml_vmark(servers, style, binary_path, client_token)?;
            Parsed::Toml(doc).serialize()
        }
    }
}

/// Remove the vmark entry from config content.
///
/// `Ok(None)` means there was no vmark entry. That is not an error, and it is
/// not the same as "here is the same document again": re-serializing an
/// untouched config rewrites the user's file and makes the caller take a
/// backup, both for nothing. (Before `preserve_order`/`toml_edit` it was worse
/// still — the rewrite alphabetised every key and ate every comment.) A config
/// we cannot *parse* is still an error.
///
/// Removing the entry takes its `env.VMARK_MCP_TOKEN` with it, which is how a
/// user rotates a credential deliberately: Uninstall, then Install.
pub(crate) fn remove_vmark_from_config(
    provider_id: &str,
    content: &str,
) -> Result<Option<String>, String> {
    let format = config_format(provider_id)?;
    let key = format.servers_key();

    let mut parsed = parse(format, content)?;
    let removed = match &mut parsed {
        Parsed::Json(json) => json
            .get_mut(key)
            .and_then(|s| s.as_object_mut())
            .and_then(|servers| servers.remove("vmark"))
            .is_some(),
        Parsed::Toml(doc) => doc
            .as_table_mut()
            .get_mut(key)
            .and_then(TomlItem::as_table_like_mut)
            .and_then(|servers| servers.remove("vmark"))
            .is_some(),
    };

    if !removed {
        return Ok(None);
    }
    parsed.serialize().map(Some)
}

#[cfg(test)]
#[path = "config_io.test.rs"]
mod tests;

#[cfg(test)]
#[path = "config_io_formats.test.rs"]
mod format_tests;
