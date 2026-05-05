//! Genie frontmatter parser.
//!
//! Parses YAML frontmatter from genie markdown files into structured metadata
//! and template content.
//!
//! Two parsing strategies are tried in order:
//!   1. **Full YAML** via `serde_yaml::from_str` — handles nested objects
//!      (`input: { type: text, ... }`) needed by Genie v1.
//!   2. **Flat key:value fallback** — used only when the frontmatter is
//!      genuinely malformed YAML; preserves the lenient behavior expected by
//!      hand-edited v0 genies that may contain non-YAML cruft.

use super::types::{GenieContent, GenieIoSpec, GenieMetadata};
use std::path::Path;

/// Derive a display name from a file path's stem, stripping control characters.
fn name_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .filter(|c| !c.is_control())
        .collect()
}

/// Parse genie content and extract metadata.
///
/// `path` must be an absolute or canonical filesystem path — the filename stem
/// is used as the display name. Callers (`read_genie`, `scan_genies_dir`) always
/// provide paths from filesystem enumeration or `fs::canonicalize`.
pub fn parse_genie(content: &str, path: &str) -> Result<GenieContent, String> {
    // Strip UTF-8 BOM if present
    let content = content.trim_start_matches('\u{FEFF}');
    let trimmed = content.trim_start();

    // Require opening fence to be exactly "---" on its own line (not "----" or "--- extra")
    let has_frontmatter = trimmed.starts_with("---")
        && trimmed[3..].starts_with(|c: char| c == '\n' || c == '\r');
    if !has_frontmatter {
        // No frontmatter — use filename as name
        let name = name_from_path(path);
        return Ok(GenieContent {
            metadata: GenieMetadata {
                name,
                description: String::new(),
                scope: "selection".to_string(),
                category: None,
                model: None,
                action: None,
                context: None,
                approval: None,
                version: None,
                input: None,
                output: None,
                tags: None,
            },
            template: content.to_string(),
        });
    }

    // Find closing ---
    let after_first = &trimmed[3..];
    let closing = after_first
        .find("\n---")
        .ok_or_else(|| format!("No closing --- in frontmatter: {}", path))?;

    let frontmatter_block = &after_first[..closing];
    let template = after_first[closing + 4..].trim_start().to_string();

    // Always derive name from filename — renaming the file changes the display name.
    // Frontmatter `name:` is intentionally ignored for this field.
    let name = name_from_path(path);

    // Parse via serde_yaml first (handles nested v1 forms).
    // On failure, fall back to the lenient flat parser for v0 compatibility.
    let metadata = match serde_yaml::from_str::<serde_yaml::Value>(frontmatter_block) {
        Ok(yaml) => metadata_from_yaml(&yaml, name.clone()),
        Err(_) => metadata_from_flat(frontmatter_block, name.clone()),
    };

    Ok(GenieContent { metadata, template })
}

/// Read a string value from a YAML mapping by key.
fn yaml_str<'a>(map: &'a serde_yaml::Mapping, key: &str) -> Option<&'a str> {
    map.get(serde_yaml::Value::String(key.to_string()))
        .and_then(|v| v.as_str())
}

/// Read a u64 value from a YAML mapping by key.
fn yaml_u64(map: &serde_yaml::Mapping, key: &str) -> Option<u64> {
    map.get(serde_yaml::Value::String(key.to_string()))
        .and_then(|v| v.as_u64())
}

/// Build metadata from a parsed YAML value.
fn metadata_from_yaml(yaml: &serde_yaml::Value, name: String) -> GenieMetadata {
    let map = match yaml.as_mapping() {
        Some(m) => m,
        None => {
            // Frontmatter is empty or scalar — treat as bare v0
            return GenieMetadata {
                name,
                description: String::new(),
                scope: "selection".to_string(),
                category: None,
                model: None,
                action: None,
                context: None,
                approval: None,
                version: None,
                input: None,
                output: None,
                tags: None,
            };
        }
    };

    let description = yaml_str(map, "description").unwrap_or("").to_string();
    let scope = yaml_str(map, "scope")
        .unwrap_or("selection")
        .to_string();
    let category = yaml_str(map, "category").map(String::from);
    let model = yaml_str(map, "model").map(String::from);
    let action = yaml_str(map, "action")
        .filter(|v| *v == "replace" || *v == "insert")
        .map(String::from);
    let context = yaml_u64(map, "context")
        .map(|v| v as u8)
        .filter(|&v| v <= 2);
    let approval = yaml_str(map, "approval")
        .filter(|v| *v == "ask" || *v == "auto")
        .map(String::from);
    let version = yaml_str(map, "genie").map(String::from);

    let (input, output, tags) = if version.as_deref() == Some("v1") {
        let input = parse_io_spec(map, "input");
        let output = parse_io_spec(map, "output");
        let tags = parse_tags(map);
        (input, output, tags)
    } else {
        (None, None, None)
    };

    GenieMetadata {
        name,
        description,
        scope,
        category,
        model,
        action,
        context,
        approval,
        version,
        input,
        output,
        tags,
    }
}

/// Parse an input or output IO spec from the YAML mapping.
///
/// Tries the nested form first (`input: { type: text, ... }`); falls back to
/// the deprecated flat form (`input_type: text`, `input_accept: ...`,
/// `input_description: ...`). Logs a warning when the flat form is used so
/// authors know to migrate.
fn parse_io_spec(map: &serde_yaml::Mapping, key: &str) -> Option<GenieIoSpec> {
    // Nested form preferred.
    if let Some(nested) = map.get(serde_yaml::Value::String(key.to_string())) {
        if let Some(nested_map) = nested.as_mapping() {
            let io_type = yaml_str(nested_map, "type")?.to_string();
            let accept = yaml_str(nested_map, "accept").map(String::from);
            let description = yaml_str(nested_map, "description").map(String::from);
            let schema = nested_map
                .get(serde_yaml::Value::String("schema".to_string()))
                .and_then(|s| serde_json::to_value(s).ok());
            return Some(GenieIoSpec {
                io_type,
                accept,
                description,
                schema,
            });
        }
        // Nested key present but malformed (not a mapping) — skip rather than crash.
        // Falls through to flat form so authors who mix can still get *something*.
    }

    // Deprecated flat form — emit one warning per invocation.
    let flat_key = format!("{}_type", key);
    if let Some(io_type) = yaml_str(map, &flat_key) {
        log::warn!(
            "Genie frontmatter uses deprecated flat form '{}_type'. \
             Use nested form: `{}: {{ type: {} }}` instead.",
            key,
            key,
            io_type
        );
        let accept = yaml_str(map, &format!("{}_accept", key)).map(String::from);
        let description = yaml_str(map, &format!("{}_description", key)).map(String::from);
        return Some(GenieIoSpec {
            io_type: io_type.to_string(),
            accept,
            description,
            schema: None,
        });
    }

    None
}

/// Parse the `tags` field as either a YAML sequence or a comma-separated string.
fn parse_tags(map: &serde_yaml::Mapping) -> Option<Vec<String>> {
    let tags_val = map.get(serde_yaml::Value::String("tags".to_string()))?;
    if let Some(seq) = tags_val.as_sequence() {
        let tags: Vec<String> = seq
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect();
        if tags.is_empty() {
            None
        } else {
            Some(tags)
        }
    } else if let Some(s) = tags_val.as_str() {
        let tags: Vec<String> = s
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if tags.is_empty() {
            None
        } else {
            Some(tags)
        }
    } else {
        None
    }
}

/// Lenient fallback parser for genuinely-malformed YAML frontmatter.
///
/// Splits each non-empty line on the first `:` and stores key→value pairs.
/// Used only when `serde_yaml::from_str` fails outright. v1 features (nested
/// input/output, schema) are unavailable here — the whole point of the
/// fallback is to keep v0 genies discoverable even when their frontmatter
/// has non-YAML cruft.
fn metadata_from_flat(frontmatter_block: &str, name: String) -> GenieMetadata {
    use std::collections::HashMap;

    let mut fields: HashMap<String, String> = HashMap::new();
    for line in frontmatter_block.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            fields.insert(
                key.trim().to_lowercase(),
                value.trim().trim_matches(|c| c == '"' || c == '\'').to_string(),
            );
        }
    }

    let version = fields.get("genie").cloned();

    GenieMetadata {
        name,
        description: fields.get("description").cloned().unwrap_or_default(),
        scope: fields
            .get("scope")
            .cloned()
            .unwrap_or_else(|| "selection".to_string()),
        category: fields.get("category").cloned(),
        model: fields.get("model").cloned(),
        action: fields
            .get("action")
            .filter(|v| v.as_str() == "replace" || v.as_str() == "insert")
            .cloned(),
        context: fields
            .get("context")
            .and_then(|v| v.parse::<u8>().ok())
            .filter(|&v| v <= 2),
        approval: fields
            .get("approval")
            .filter(|v| v.as_str() == "ask" || v.as_str() == "auto")
            .cloned(),
        version,
        // Flat fallback never produces v1 nested IO. v1 authors must keep their
        // YAML well-formed; the previous flat workaround keys are handled in
        // metadata_from_yaml's flat branch only when serde_yaml succeeds.
        input: None,
        output: None,
        tags: None,
    }
}
