//! A provider config as a parsed document, and how to reach the `vmark` entry
//! inside it.
//!
//! Split out of `config_io.rs`, which kept growing because it held both the
//! *representation* (parse, navigate, serialize) and the *operations* (read,
//! generate, remove). This file is the representation only: two formats behind
//! one shape, so every operation navigates them identically and none of them
//! can invent its own idea of where the vmark entry lives.
//!
//! Round-tripping is non-destructive on both sides. JSON keeps key order via
//! `serde_json`'s `preserve_order`; TOML keeps comments, blank lines, key order
//! and inline-vs-table style via `toml_edit`.

use super::client_token_field;
use super::config_io::ConfigFormat;
use serde_json::Value as JsonValue;
use toml_edit::{DocumentMut, Item as TomlItem};

/// Parse config text, tagging the error with the format so every caller
/// reports "Invalid JSON"/"Invalid TOML" identically.
pub(crate) fn parse(format: ConfigFormat, content: &str) -> Result<Parsed, String> {
    match format {
        ConfigFormat::Json => serde_json::from_str(content)
            .map(Parsed::Json)
            .map_err(|e| {
                rust_i18n::t!("errors.mcp.invalidJson", detail = e.to_string()).to_string()
            }),
        ConfigFormat::Toml => content
            .parse::<DocumentMut>()
            .map(Parsed::Toml)
            .map_err(|e| {
                rust_i18n::t!("errors.mcp.invalidToml", detail = e.to_string()).to_string()
            }),
    }
}

/// Treat a whitespace-only existing config as absent.
///
/// A zero-byte file is not valid JSON, and clients do create one before ever
/// writing to it. Erroring on that would strand those users; erroring on
/// *content* we cannot parse is the point of `generate_config_content`.
pub(crate) fn merge_base(existing_content: Option<&str>) -> Option<&str> {
    existing_content.filter(|c| !c.trim().is_empty())
}

/// A parsed config document in whichever representation its provider uses.
///
/// The TOML side is a `toml_edit::DocumentMut`, not a `toml::Table`: it keeps
/// the original spans, so comments, blank lines, key order and inline-vs-table
/// style all survive a parse/serialise round trip. `~/.codex/config.toml` is a
/// file users hand-write and hand-comment — losing that is losing their work,
/// and no serde `preserve_order`-style flag can give a comment back.
pub(crate) enum Parsed {
    Json(JsonValue),
    Toml(DocumentMut),
}

impl Parsed {
    /// The `vmark` entry under this document's server map, if present.
    pub(crate) fn vmark_entry(&self) -> Option<VmarkEntry<'_>> {
        match self {
            Parsed::Json(json) => json
                .get(ConfigFormat::Json.servers_key())
                .and_then(|s| s.get("vmark"))
                .map(VmarkEntry::Json),
            Parsed::Toml(doc) => doc
                .get(ConfigFormat::Toml.servers_key())
                .and_then(TomlItem::as_table_like)
                .and_then(|s| s.get("vmark"))
                .map(VmarkEntry::Toml),
        }
    }

    pub(crate) fn serialize(&self) -> Result<String, String> {
        match self {
            Parsed::Json(json) => serde_json::to_string_pretty(json).map_err(|e| {
                rust_i18n::t!("errors.mcp.jsonSerializeFailed", detail = e.to_string()).to_string()
            }),
            // Infallible: the document already holds every byte it will emit.
            Parsed::Toml(doc) => Ok(doc.to_string()),
        }
    }
}

pub(crate) enum VmarkEntry<'a> {
    Json(&'a JsonValue),
    Toml(&'a TomlItem),
}

impl VmarkEntry<'_> {
    pub(crate) fn command(&self) -> Option<&str> {
        match self {
            VmarkEntry::Json(v) => v.get("command").and_then(|c| c.as_str()),
            VmarkEntry::Toml(v) => v.as_table_like()?.get("command").and_then(TomlItem::as_str),
        }
    }

    /// The per-client credential VMark issued to this provider, if any.
    pub(crate) fn client_token(&self) -> Option<String> {
        match self {
            VmarkEntry::Json(v) => client_token_field::read_json(v),
            VmarkEntry::Toml(v) => client_token_field::read_toml(v),
        }
    }
}
