//! The one YAML parser every VMark input goes through.
//!
//! Purpose: genie frontmatter, YAML workflow genies, workflow files and
//! GitHub `action.yml` files are all parsed here, so the parser and its
//! settings are chosen once and every caller gets the same rules.
//!
//! Key decisions:
//!   - `serde-saphyr`, a YAML parser in safe Rust. The previous crate,
//!     `serde_yaml_ng`, sits on `unsafe-libyaml`, a machine translation of
//!     libyaml's C into unsafe Rust that is archived and unmaintained
//!     (RUSTSEC-2024-0449).
//!   - `strict_booleans`: only `true` and `false` are booleans, as under the
//!     YAML 1.2 schema the old parser used. serde-saphyr would otherwise also
//!     read `yes`, `no`, `on` and `off` into a `bool` field.
//!   - Duplicate keys stay an error (the crate default, and the old
//!     behaviour), and the crate's default budget bounds alias expansion and
//!     nesting, so a hostile file fails instead of exhausting memory.
//!   - Untyped YAML deserializes into `serde_json::Value`, the dynamic value
//!     type the crate already uses everywhere else; [`Value`] and
//!     [`Mapping`] name it for YAML callers.

use serde::de::DeserializeOwned;

/// A parsed YAML document of unknown shape.
pub type Value = serde_json::Value;
/// A YAML mapping with string keys.
pub type Mapping = serde_json::Map<String, Value>;
/// A YAML syntax, budget or type error. Its `Display` carries the position.
pub type Error = serde_saphyr::Error;

/// Parse YAML text into `T` under VMark's settings.
pub fn from_str<T: DeserializeOwned>(text: &str) -> Result<T, Error> {
    let options = serde_saphyr::options! {
        strict_booleans: true,
    };
    serde_saphyr::from_str_with_options(text, options)
}

#[cfg(test)]
#[path = "yaml.test.rs"]
mod tests;
