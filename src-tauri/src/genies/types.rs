//! Genie type definitions.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct GenieEntry {
    pub name: String,
    pub path: String,
    pub source: String, // "global"
    pub category: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GenieContent {
    pub metadata: GenieMetadata,
    pub template: String,
}

#[derive(Debug, Serialize)]
pub struct GenieMetadata {
    pub name: String,
    pub description: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Suggestion type: "replace" (default) or "insert" (append after source).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Number of surrounding blocks to include as context (0–2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<u8>,
}

/// Entry returned by menu scanning — includes resolved title from frontmatter.
pub struct GenieMenuEntry {
    pub title: String,
    pub path: String,
    pub category: Option<String>,
}
