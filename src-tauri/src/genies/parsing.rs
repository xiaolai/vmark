//! Genie frontmatter parser.
//!
//! Parses YAML-like frontmatter from genie markdown files into
//! structured metadata and template content.

use super::types::{GenieContent, GenieMetadata};
use std::collections::HashMap;
use std::path::Path;

pub(crate) fn parse_genie(content: &str, path: &str) -> Result<GenieContent, String> {
    // Strip UTF-8 BOM if present
    let content = content.trim_start_matches('\u{FEFF}');
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        // No frontmatter — use filename as name
        let name = Path::new(path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        return Ok(GenieContent {
            metadata: GenieMetadata {
                name,
                description: String::new(),
                scope: "selection".to_string(),
                category: None,
                model: None,
                action: None,
                context: None,
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

    // Parse key: value lines
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

    let name = fields
        .get("name")
        .cloned()
        .unwrap_or_else(|| {
            Path::new(path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

    Ok(GenieContent {
        metadata: GenieMetadata {
            name,
            description: fields.get("description").cloned().unwrap_or_default(),
            scope: fields
                .get("scope")
                .cloned()
                .unwrap_or_else(|| "selection".to_string()),
            category: fields.get("category").cloned(),
            model: fields.get("model").cloned(),
            action: fields.get("action").filter(|v| v.as_str() == "replace" || v.as_str() == "insert").cloned(),
            context: fields.get("context")
                .and_then(|v| v.parse::<u8>().ok())
                .filter(|&v| v <= 2),
        },
        template,
    })
}
