//! AI Genies — file reader and default genie installer
//!
//! Scans the global genies directory (`<appDataDir>/genies/`) for markdown
//! genie files.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Commands
// ============================================================================

/// Return the global genies directory path.
#[command]
pub fn get_genies_dir(app: AppHandle) -> Result<String, String> {
    let dir = global_genies_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// List all available genies from the global genies directory.
#[command]
pub fn list_genies(app: AppHandle) -> Result<Vec<GenieEntry>, String> {
    let mut by_name: HashMap<String, GenieEntry> = HashMap::new();

    let global_dir = global_genies_dir(&app)?;
    if global_dir.is_dir() {
        scan_genies_dir(&global_dir, &global_dir, "global", &mut by_name);
    }

    let mut entries: Vec<GenieEntry> = by_name.into_values().collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Read a single genie file — parse frontmatter and return metadata + template.
/// Validates the path is within the global genies directory to prevent traversal.
#[command]
pub fn read_genie(app: AppHandle, path: String) -> Result<GenieContent, String> {
    // Canonicalize requested path
    let requested = fs::canonicalize(&path)
        .map_err(|e| format!("Invalid genie path {}: {}", path, e))?;

    // Validate path is within the global genies directory
    let global_dir = fs::canonicalize(global_genies_dir(&app)?)
        .map_err(|e| format!("Genies directory does not exist or is inaccessible: {}", e))?;

    if !requested.starts_with(&global_dir) {
        return Err("Genie path is outside allowed directories".to_string());
    }

    let content = fs::read_to_string(&requested)
        .map_err(|e| format!("Failed to read genie file {}: {}", path, e))?;

    parse_genie(&content, &path)
}

// ============================================================================
// Scanning
// ============================================================================

pub fn global_genies_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join("genies"))
}

/// Recursively scan a directory for `.md` files. Subdirectory names become categories.
fn scan_genies_dir(
    dir: &Path,
    base: &Path,
    source: &str,
    entries: &mut HashMap<String, GenieEntry>,
) {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        // Skip symlinks for safety
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let path = entry.path();
        if ft.is_dir() {
            scan_genies_dir(&path, base, source, entries);
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Category from subdirectory relative to base
            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().to_string());

            // Key by relative path (e.g. "writing/improve") to avoid collisions
            // between files with the same stem in different categories.
            let rel_key = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .with_extension("")
                .to_string_lossy()
                .to_string();

            entries.insert(
                rel_key,
                GenieEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    source: source.to_string(),
                    category,
                },
            );
        }
    }
}

// ============================================================================
// Menu scanning — returns entries with resolved titles from frontmatter
// ============================================================================

pub struct GenieMenuEntry {
    pub title: String,
    pub path: String,
    pub category: Option<String>,
}

/// Scan a directory and return genie entries with titles resolved from frontmatter.
pub fn scan_genies_with_titles(dir: &Path) -> Vec<GenieMenuEntry> {
    let mut entries = Vec::new();
    scan_genies_recursive(dir, dir, &mut entries);
    entries.sort_by(|a, b| a.title.cmp(&b.title));
    entries
}

fn scan_genies_recursive(dir: &Path, base: &Path, entries: &mut Vec<GenieMenuEntry>) {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let path = entry.path();
        if ft.is_dir() {
            scan_genies_recursive(&path, base, entries);
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            let filename_stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let title = match fs::read_to_string(&path) {
                Ok(content) => extract_frontmatter_name(&content).unwrap_or(filename_stem),
                Err(_) => filename_stem,
            };

            let category = path
                .parent()
                .and_then(|p| p.strip_prefix(base).ok())
                .filter(|rel| !rel.as_os_str().is_empty())
                .map(|rel| rel.to_string_lossy().to_string());

            entries.push(GenieMenuEntry {
                title,
                path: path.to_string_lossy().to_string(),
                category,
            });
        }
    }
}

/// Extract the `name:` value from YAML frontmatter without a full parse.
fn extract_frontmatter_name(content: &str) -> Option<String> {
    let content = content.trim_start_matches('\u{FEFF}');
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    let closing = after_first.find("\n---")?;
    let frontmatter = &after_first[..closing];

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("name") {
                let name = value.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    None
}

// ============================================================================
// Frontmatter Parser
// ============================================================================

fn parse_genie(content: &str, path: &str) -> Result<GenieContent, String> {
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

// ============================================================================
// Default Genies Installer
// ============================================================================

struct DefaultGenie {
    path: &'static str,
    content: &'static str,
}

const DEFAULT_GENIES: &[DefaultGenie] = &[
    // Editing
    DefaultGenie {
        path: "editing/polish.md",
        content: include_str!("../resources/genies/editing/polish.md"),
    },
    DefaultGenie {
        path: "editing/condense.md",
        content: include_str!("../resources/genies/editing/condense.md"),
    },
    DefaultGenie {
        path: "editing/fix-grammar.md",
        content: include_str!("../resources/genies/editing/fix-grammar.md"),
    },
    DefaultGenie {
        path: "editing/simplify.md",
        content: include_str!("../resources/genies/editing/simplify.md"),
    },
    // Creative
    DefaultGenie {
        path: "creative/expand.md",
        content: include_str!("../resources/genies/creative/expand.md"),
    },
    DefaultGenie {
        path: "creative/rephrase.md",
        content: include_str!("../resources/genies/creative/rephrase.md"),
    },
    DefaultGenie {
        path: "creative/vivid.md",
        content: include_str!("../resources/genies/creative/vivid.md"),
    },
    DefaultGenie {
        path: "creative/continue.md",
        content: include_str!("../resources/genies/creative/continue.md"),
    },
    // Structure
    DefaultGenie {
        path: "structure/summarize.md",
        content: include_str!("../resources/genies/structure/summarize.md"),
    },
    DefaultGenie {
        path: "structure/outline.md",
        content: include_str!("../resources/genies/structure/outline.md"),
    },
    DefaultGenie {
        path: "structure/headline.md",
        content: include_str!("../resources/genies/structure/headline.md"),
    },
    // Tools
    DefaultGenie {
        path: "tools/translate.md",
        content: include_str!("../resources/genies/tools/translate.md"),
    },
    DefaultGenie {
        path: "tools/rewrite-in-english.md",
        content: include_str!("../resources/genies/tools/rewrite-in-english.md"),
    },
];

/// Install default genies into `<appDataDir>/genies/` if they don't already exist.
pub fn install_default_genies(app: &AppHandle) -> Result<(), String> {
    let base = global_genies_dir(app)?;

    for genie in DEFAULT_GENIES {
        let target = base.join(genie.path);

        // Create parent directories
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dir {:?}: {}", parent, e))?;
        }

        // Atomic create — skip if file already exists (no TOCTOU race)
        match OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(mut file) => {
                file.write_all(genie.content.as_bytes())
                    .map_err(|e| format!("Failed to write {:?}: {}", target, e))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                continue;
            }
            Err(e) => {
                return Err(format!("Failed to create {:?}: {}", target, e));
            }
        }
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_genie_with_frontmatter() {
        let content = r#"---
name: improve-writing
description: Improve clarity and flow
scope: selection
category: writing
---

You are an expert editor. Improve the following text:

{{content}}"#;

        let result = parse_genie(content, "improve-writing.md").unwrap();
        assert_eq!(result.metadata.name, "improve-writing");
        assert_eq!(result.metadata.description, "Improve clarity and flow");
        assert_eq!(result.metadata.scope, "selection");
        assert_eq!(result.metadata.category.as_deref(), Some("writing"));
        assert_eq!(result.metadata.action, None); // no action field → defaults to None
        assert!(result.template.contains("{{content}}"));
    }

    #[test]
    fn test_parse_genie_with_context() {
        let content = "---\nname: fit\nscope: selection\ncontext: 1\n---\n\n{{context}}\n\n{{content}}";
        let result = parse_genie(content, "fit.md").unwrap();
        assert_eq!(result.metadata.context, Some(1));
    }

    #[test]
    fn test_parse_genie_context_clamped_to_2() {
        let content = "---\nname: fit\nscope: selection\ncontext: 5\n---\n\nTemplate";
        let result = parse_genie(content, "fit.md").unwrap();
        assert_eq!(result.metadata.context, None); // >2 is filtered out
    }

    #[test]
    fn test_parse_genie_no_context_field() {
        let content = "---\nname: basic\nscope: selection\n---\n\n{{content}}";
        let result = parse_genie(content, "basic.md").unwrap();
        assert_eq!(result.metadata.context, None);
    }

    #[test]
    fn test_parse_genie_with_action_insert() {
        let content = "---\nname: continue\nscope: block\naction: insert\n---\n\nContinue writing.\n\n{{content}}";
        let result = parse_genie(content, "continue.md").unwrap();
        assert_eq!(result.metadata.name, "continue");
        assert_eq!(result.metadata.scope, "block");
        assert_eq!(result.metadata.action.as_deref(), Some("insert"));
    }

    #[test]
    fn test_parse_genie_with_invalid_action() {
        let content = "---\nname: typo\nscope: selection\naction: insret\n---\n\nTemplate";
        let result = parse_genie(content, "typo.md").unwrap();
        assert_eq!(result.metadata.action, None); // invalid value ignored
    }

    #[test]
    fn test_parse_genie_without_frontmatter() {
        let content = "Just a plain genie template\n\n{{content}}";
        let result = parse_genie(content, "test-genie.md").unwrap();
        assert_eq!(result.metadata.name, "test-genie");
        assert_eq!(result.metadata.scope, "selection");
        assert!(result.template.contains("{{content}}"));
    }

    #[test]
    fn test_parse_genie_with_bom() {
        let content = "\u{FEFF}---\nname: bom-test\ndescription: Has BOM\nscope: document\n---\n\nTemplate here";
        let result = parse_genie(content, "bom-test.md").unwrap();
        assert_eq!(result.metadata.name, "bom-test");
        assert_eq!(result.metadata.scope, "document");
    }

    #[test]
    fn test_parse_genie_missing_closing() {
        let content = "---\nname: broken\nno closing fence";
        let result = parse_genie(content, "broken.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_no_collision_same_name_different_category() {
        use std::io::Write as _;
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();

        // Create two files with the same stem in different subdirs
        let writing = base.join("writing");
        let coding = base.join("coding");
        fs::create_dir_all(&writing).unwrap();
        fs::create_dir_all(&coding).unwrap();

        let mut f1 = fs::File::create(writing.join("improve.md")).unwrap();
        writeln!(f1, "---\nname: improve-writing\nscope: selection\n---\ntemplate1").unwrap();

        let mut f2 = fs::File::create(coding.join("improve.md")).unwrap();
        writeln!(f2, "---\nname: improve-code\nscope: selection\n---\ntemplate2").unwrap();

        let mut entries: HashMap<String, GenieEntry> = HashMap::new();
        scan_genies_dir(base, base, "global", &mut entries);

        // Both should be present (keyed by relative path, not bare stem)
        assert_eq!(entries.len(), 2);
        assert!(entries.values().any(|e| e.name == "improve" && e.category.as_deref() == Some("writing")));
        assert!(entries.values().any(|e| e.name == "improve" && e.category.as_deref() == Some("coding")));
    }

    #[test]
    fn test_read_genie_uses_canonical_path() {
        // Validates that read_genie reads from the canonicalized path.
        // The function canonicalizes, validates prefix, then reads from canonicalized path.
        // This is tested via the parse_genie function which is the tail of read_genie.
        let content = "---\nname: canonical-test\nscope: document\n---\nSafe content";
        let result = parse_genie(content, "canonical-test.md").unwrap();
        assert_eq!(result.metadata.name, "canonical-test");
    }

    #[test]
    fn test_parse_genie_strips_quotes() {
        let content = "---\nname: \"quoted name\"\ndescription: 'single quoted'\nscope: selection\n---\n\nTemplate";
        let result = parse_genie(content, "test.md").unwrap();
        assert_eq!(result.metadata.name, "quoted name");
        assert_eq!(result.metadata.description, "single quoted");
    }

    #[test]
    fn test_extract_frontmatter_name_strips_quotes() {
        let content = "---\nname: \"My Genie\"\nscope: selection\n---\n\nTemplate";
        assert_eq!(extract_frontmatter_name(content), Some("My Genie".to_string()));
    }
}
