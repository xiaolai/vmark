//! The `vmark` server entry itself — upsert only the fields VMark owns.
//!
//! Install used to `insert("vmark", { "command": … })`, replacing the whole
//! entry. That is the same class of bug as replacing the whole `mcpServers`
//! object, one level deeper: a user's `env`, `timeout`, `disabled` flag or
//! extra `args` on OUR entry were silently discarded on every install and
//! every Repair click.
//!
//! What VMark owns, and nothing else:
//! - `command` — the sidecar binary path; rewritten on every install.
//! - `env.VMARK_MCP_TOKEN` — the per-client credential the bridge binds its
//!   authorization principal to. Owned by `client_token_field.rs`, which
//!   writes only that ONE key inside `env` and leaves the user's other
//!   variables byte-identical.
//! - the legacy `--port <n>` pair inside `args` — written by installs before
//!   the file-based port handshake (commit "auto-discover port via file-based
//!   handshake"). The sidecar ignores it now, and leaving it in place makes a
//!   repaired config look configured for a port that no longer exists.
//!
//! Everything else on the entry is the user's and is left byte-identical.
//!
//! The two formats no longer share one generic strip. `toml_edit::Array` is
//! not a `Vec`, and its elements carry their own formatting, so the *removal*
//! mechanics differ. What must not drift is the *rule*, and that lives in
//! exactly one place: `legacy_port_arg_indices`.

use super::client_token_field;
use serde_json::{Map, Value as JsonValue};
use toml_edit::{Array, InlineTable, Item as TomlItem, Table, TableLike, Value as TomlValue};

/// The obsolete flag whose value argument is also ours to drop.
const LEGACY_PORT_FLAG: &str = "--port";

/// Indices to drop from an `args` list: every `--port` and the value that
/// follows it. Shared by both formats so JSON and TOML cannot drift.
fn legacy_port_arg_indices(args: &[String]) -> Vec<usize> {
    let mut drop = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == LEGACY_PORT_FLAG {
            drop.push(i);
            // The port number itself, when present.
            if i + 1 < args.len() {
                drop.push(i + 1);
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    drop
}

/// Strip the legacy `--port <n>` pair from a JSON `args` list in place.
///
/// Returns true only when the strip *emptied* the list — i.e. the list held
/// nothing but our own obsolete artifact, so the `args` key should go with
/// it. A list that never contained the pair is not touched at all, which is
/// what keeps a user-authored `args: []` alive: it carries their intent, it
/// is not something VMark wrote, and "ended up empty" is not the same
/// question as "was emptied by us".
fn strip_json_legacy_port_args(args: &mut Vec<JsonValue>) -> bool {
    let flat: Vec<String> = args
        .iter()
        .map(|a| a.as_str().unwrap_or_default().to_string())
        .collect();
    let drop = legacy_port_arg_indices(&flat);
    if drop.is_empty() {
        return false;
    }

    let mut idx = 0;
    args.retain(|_| {
        let keep = !drop.contains(&idx);
        idx += 1;
        keep
    });
    args.is_empty()
}

/// The TOML twin of `strip_json_legacy_port_args`, with the same contract.
///
/// Element formatting is per-element in `toml_edit`, so deleting the first
/// element would otherwise strand its leading trivia (the newline and any
/// comment that opened a multi-line array). That trivia belongs to the array,
/// not to the element we are deleting, so it is handed to whichever element
/// becomes first.
fn strip_toml_legacy_port_args(args: &mut Array) -> bool {
    let flat: Vec<String> = args
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect();
    let drop = legacy_port_arg_indices(&flat);
    if drop.is_empty() {
        return false;
    }

    let leading = if drop.contains(&0) {
        args.get(0).and_then(|v| v.decor().prefix().cloned())
    } else {
        None
    };

    let mut idx = 0;
    args.retain(|_| {
        let keep = !drop.contains(&idx);
        idx += 1;
        keep
    });

    if let (Some(leading), Some(first)) = (leading, args.get_mut(0)) {
        first.decor_mut().set_prefix(leading);
    }
    args.is_empty()
}

pub(crate) fn upsert_json_vmark(
    servers: &mut Map<String, JsonValue>,
    binary_path: &str,
    client_token: &str,
) -> Result<(), String> {
    let entry = servers
        .entry("vmark")
        .or_insert_with(|| JsonValue::Object(Map::new()));
    let entry = entry
        .as_object_mut()
        .ok_or_else(|| rust_i18n::t!("errors.mcp.vmarkEntryNotObject").to_string())?;

    entry.insert(
        "command".to_string(),
        JsonValue::String(binary_path.to_string()),
    );
    client_token_field::write_json(entry, client_token)?;

    if let Some(JsonValue::Array(args)) = entry.get_mut("args") {
        if strip_json_legacy_port_args(args) {
            entry.remove("args");
        }
    }

    Ok(())
}

/// How a `vmark` entry we have to CREATE must be written.
///
/// A standard `[mcp_servers.vmark]` header is the idiomatic Codex form, but it
/// is illegal in a *value* context — inside an inline `mcp_servers = { … }` or
/// under a dotted `mcp_servers.other.command = …`. There, `toml_edit` does not
/// merely emit invalid TOML: `InlineTable`'s `TableLike::insert` unwraps
/// `Item::into_value` and panics. So the style follows the one the user chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TomlEntryStyle {
    Standard,
    Inline,
}

impl TomlEntryStyle {
    /// The style a child of `parent` must be written in.
    ///
    /// Asked twice per install, of two different parents: of `mcp_servers` for
    /// the `vmark` entry, and of the `vmark` entry for its `env` table. They
    /// are not always the same answer — a standard `[mcp_servers]` may hold an
    /// inline `vmark = { … }` — and getting the second one from the first
    /// would panic inside `toml_edit`.
    pub(crate) fn of_parent(parent: &TomlItem) -> Self {
        let dotted = parent.as_table_like().is_some_and(TableLike::is_dotted);
        if parent.is_inline_table() || dotted {
            Self::Inline
        } else {
            Self::Standard
        }
    }

    pub(crate) fn empty_entry(self) -> TomlItem {
        match self {
            Self::Standard => TomlItem::Table(Table::new()),
            Self::Inline => TomlItem::Value(TomlValue::InlineTable(InlineTable::new())),
        }
    }
}

pub(crate) fn upsert_toml_vmark(
    servers: &mut dyn TableLike,
    style: TomlEntryStyle,
    binary_path: &str,
    client_token: &str,
) -> Result<(), String> {
    if !servers.contains_key("vmark") {
        servers.insert("vmark", style.empty_entry());
    }
    // The `env` table's style follows the ENTRY, not `mcp_servers`. Read
    // before the mutable borrow below.
    let env_style = TomlEntryStyle::of_parent(
        servers
            .get("vmark")
            .ok_or_else(|| rust_i18n::t!("errors.mcp.vmarkEntryNotTable").to_string())?,
    );
    let entry = servers
        .get_mut("vmark")
        .and_then(TomlItem::as_table_like_mut)
        .ok_or_else(|| rust_i18n::t!("errors.mcp.vmarkEntryNotTable").to_string())?;

    set_toml_string(entry, "command", binary_path);
    client_token_field::write_toml(entry, env_style, client_token)?;

    let emptied = match entry.get_mut("args").and_then(TomlItem::as_array_mut) {
        Some(args) => strip_toml_legacy_port_args(args),
        None => false,
    };
    if emptied {
        entry.remove("args");
    }

    Ok(())
}

/// Rewrite a string-valued key, keeping the formatting around it.
///
/// The spacing after `=` and any trailing `# comment` on that line live in the
/// *value's* decor, so swapping the value wholesale would eat them. And an
/// unchanged value is not rewritten at all: re-emitting it would normalise a
/// literal `'…'` string the user typed into a basic `"…"` one, turning a no-op
/// install into a diff.
///
/// Shared by `command` and by `env.VMARK_MCP_TOKEN`
/// (`client_token_field::write_toml`) so the two cannot drift on decor
/// handling.
pub(crate) fn set_toml_string(entry: &mut dyn TableLike, key: &str, value: &str) {
    match entry.get_mut(key) {
        Some(item) if item.as_str() == Some(value) => {}
        Some(item) => {
            let decor = item.as_value().map(|v| v.decor().clone());
            let mut new_value = TomlValue::from(value);
            if let Some(decor) = decor {
                *new_value.decor_mut() = decor;
            }
            *item = TomlItem::Value(new_value);
        }
        None => {
            entry.insert(key, TomlItem::Value(TomlValue::from(value)));
        }
    }
}

#[cfg(test)]
#[path = "vmark_entry.test.rs"]
mod tests;
