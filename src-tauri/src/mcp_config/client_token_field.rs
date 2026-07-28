//! The one field that carries a client's identity: `env.VMARK_MCP_TOKEN`.
//!
//! Both sides of that field live here — the write (install puts a credential
//! into the provider's `vmark` entry) and the read (the bridge asks which
//! provider a presented credential belongs to). Splitting them across
//! `vmark_entry.rs` and `config_io.rs` would mean the key name, the
//! placeholder, and the "what counts as a usable token" rule existed in two
//! copies that can drift; here they cannot.
//!
//! What this field is FOR (audit 20260728 §2.1): the bridge's authorization
//! principal used to be `identity.name` from the client's own `identify`
//! message, which any token-holder could assert and re-assert. The credential
//! written here is minted by VMark, stored only in the config of the client it
//! names, and verified during the auth handshake — so the principal is bound
//! to something VMark issued rather than to something the client claims.
//!
//! What it is NOT: protection against a hostile same-UID process. That process
//! can read `~/.claude.json` and `~/.codex/config.toml` just as it can read the
//! bridge's 0600 port file (§2.4, accepted). What this removes is *trivial*
//! impersonation — asserting a name costs nothing; obtaining another client's
//! credential means reading that client's config — and, just as importantly, a
//! whole class of honest misattribution: `detectClientIdentity()` in the
//! sidecar guesses its own name from the parent process name, so a wrapper
//! script was enough to make the ledger record the wrong actor.

use super::vmark_entry::{set_toml_string, TomlEntryStyle};
use serde_json::{Map, Value as JsonValue};
use toml_edit::{Item as TomlItem, TableLike};

/// The environment variable the sidecar reads its credential from.
///
/// Mirrored in `vmark-mcp-server/src/utils/clientIdentity.ts`.
pub(crate) const TOKEN_ENV_KEY: &str = "VMARK_MCP_TOKEN";

/// Rendered in the install PREVIEW in place of a credential that does not
/// exist yet.
///
/// The preview promises "this is the file I will write". A token is minted at
/// install time, so rendering a *random* one here would show the user a secret
/// the install then replaces with a different secret — a promise the dialog
/// cannot keep. This says what will actually happen instead.
///
/// Deliberately not localized: the preview pane renders raw config bytes,
/// whose keys (`mcpServers`, `command`, `VMARK_MCP_TOKEN`) are English by
/// construction. A translated placeholder would make the *file content* the
/// dialog shows depend on the UI language.
///
/// [`usable`] treats it as absent, so a user who hand-copies the preview into
/// their config cannot end up with the literal placeholder as a credential —
/// and two users doing that cannot end up sharing one.
pub(crate) const TOKEN_PLACEHOLDER: &str = "<generated on install>";

/// Whether a raw field value is a credential VMark can bind a principal to.
///
/// Blank, whitespace-only, and the preview placeholder all mean "no credential
/// configured" — never "a credential that happens to be empty". An empty token
/// must not authenticate anything (`handshake::token_matches` refuses one too).
pub(crate) fn usable(raw: Option<&str>) -> Option<String> {
    let token = raw?.trim();
    if token.is_empty() || token == TOKEN_PLACEHOLDER {
        return None;
    }
    Some(token.to_string())
}

/// Read the credential out of a JSON `vmark` entry.
pub(crate) fn read_json(entry: &JsonValue) -> Option<String> {
    usable(
        entry
            .get("env")
            .and_then(|env| env.get(TOKEN_ENV_KEY))
            .and_then(JsonValue::as_str),
    )
}

/// Read the credential out of a TOML `vmark` entry.
pub(crate) fn read_toml(entry: &TomlItem) -> Option<String> {
    usable(
        entry
            .as_table_like()?
            .get("env")
            .and_then(TomlItem::as_table_like)
            .and_then(|env| env.get(TOKEN_ENV_KEY))
            .and_then(TomlItem::as_str),
    )
}

/// Write the credential into a JSON `vmark` entry, keeping the user's `env`.
///
/// VMark owns exactly one key inside `env`. Replacing the whole object would
/// be the same bug `vmark_entry.rs` exists to prevent, one level deeper: an
/// `env` holding the user's `NODE_OPTIONS` or `HTTPS_PROXY` would be discarded
/// on every install and every Repair click.
pub(crate) fn write_json(entry: &mut Map<String, JsonValue>, token: &str) -> Result<(), String> {
    let env = entry
        .entry("env")
        .or_insert_with(|| JsonValue::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| rust_i18n::t!("errors.mcp.envNotObject").to_string())?;
    env.insert(
        TOKEN_ENV_KEY.to_string(),
        JsonValue::String(token.to_string()),
    );
    Ok(())
}

/// Write the credential into a TOML `vmark` entry, keeping the user's `env`.
///
/// `style` is the style a child of the *entry* must take, which is not always
/// the style a child of `mcp_servers` takes: a standard `[mcp_servers]` may
/// hold an inline `vmark = { command = "…" }`, and inserting a standard
/// `Item::Table` into an `InlineTable` does not merely emit invalid TOML —
/// `TableLike::insert` unwraps `Item::into_value` and panics.
pub(crate) fn write_toml(
    entry: &mut dyn TableLike,
    style: TomlEntryStyle,
    token: &str,
) -> Result<(), String> {
    if !entry.contains_key("env") {
        entry.insert("env", style.empty_entry());
    }
    let env = entry
        .get_mut("env")
        .and_then(TomlItem::as_table_like_mut)
        .ok_or_else(|| rust_i18n::t!("errors.mcp.envNotTable").to_string())?;
    set_toml_string(env, TOKEN_ENV_KEY, token);
    Ok(())
}

#[cfg(test)]
#[path = "client_token_field.test.rs"]
mod tests;
