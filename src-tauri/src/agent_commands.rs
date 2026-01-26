//! Agent Commands File System
//!
//! Manages user-defined AI command files stored in Application Support.
//! Commands are markdown files with YAML frontmatter organized in category folders.
//!
//! Structure:
//! ~/Library/Application Support/app.vmark/agents/
//! ├── writing/
//! │   ├── improve.md
//! │   └── proofread.md
//! └── translate/
//!     ├── to-chinese.md
//!     └── to-english.md

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

/// A category of agent commands (folder)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCategory {
    pub id: String,
    pub name: String,
    pub commands: Vec<AgentCommand>,
}

/// An individual agent command (markdown file)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommand {
    pub id: String,
    pub path: String,
    pub label: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub tools: Option<Vec<String>>,
    pub content: String,
}

/// Frontmatter structure
#[derive(Debug, Deserialize, Default)]
struct Frontmatter {
    label: Option<String>,
    description: Option<String>,
    model: Option<String>,
    tools: Option<Vec<String>>,
}

/// Get the agents directory path
fn get_agents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join("agents"))
}

/// Convert a folder name to a display name (title case)
fn folder_to_display_name(name: &str) -> String {
    name.replace('-', " ")
        .replace('_', " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Convert a filename to a label (without extension, title case)
fn filename_to_label(name: &str) -> String {
    let stem = name.strip_suffix(".md").unwrap_or(name);
    folder_to_display_name(stem)
}

/// Parse a markdown file with YAML frontmatter
fn parse_command_file(path: &PathBuf) -> Result<AgentCommand, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Parse frontmatter if present
    let (frontmatter, body) = if content.starts_with("---") {
        // Find the closing ---
        if let Some(end) = content[3..].find("---") {
            let yaml_content = &content[3..3 + end];
            let body = content[3 + end + 3..].trim_start();

            let fm: Frontmatter = serde_yaml::from_str(yaml_content)
                .unwrap_or_default();

            (fm, body.to_string())
        } else {
            (Frontmatter::default(), content)
        }
    } else {
        (Frontmatter::default(), content)
    };

    let label = frontmatter
        .label
        .unwrap_or_else(|| filename_to_label(&id));

    Ok(AgentCommand {
        id,
        path: path.to_string_lossy().to_string(),
        label,
        description: frontmatter.description,
        model: frontmatter.model,
        tools: frontmatter.tools,
        content: body,
    })
}

/// List all agent command categories and their commands
#[command]
pub async fn list_agent_commands(app: AppHandle) -> Result<Vec<CommandCategory>, String> {
    let agents_dir = get_agents_dir(&app)?;

    // Create agents directory if it doesn't exist
    if !agents_dir.exists() {
        fs::create_dir_all(&agents_dir)
            .map_err(|e| format!("Failed to create agents dir: {}", e))?;

        // Copy default commands on first run
        copy_default_commands(&app, &agents_dir)?;
    }

    let mut categories = Vec::new();

    // Read category folders
    let entries = fs::read_dir(&agents_dir)
        .map_err(|e| format!("Failed to read agents dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");

        // Skip hidden folders
        if folder_name.starts_with('.') {
            continue;
        }

        let mut commands = Vec::new();

        // Read command files in this category
        if let Ok(files) = fs::read_dir(&path) {
            for file_entry in files.flatten() {
                let file_path = file_entry.path();
                if file_path.extension().map_or(false, |ext| ext == "md") {
                    if let Ok(cmd) = parse_command_file(&file_path) {
                        commands.push(cmd);
                    }
                }
            }
        }

        // Sort commands by label
        commands.sort_by(|a, b| a.label.cmp(&b.label));

        if !commands.is_empty() {
            categories.push(CommandCategory {
                id: folder_name.to_string(),
                name: folder_to_display_name(folder_name),
                commands,
            });
        }
    }

    // Sort categories by name
    categories.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(categories)
}

/// Read a single agent command by path
#[command]
pub async fn read_agent_command(path: String) -> Result<AgentCommand, String> {
    let path_buf = PathBuf::from(&path);
    parse_command_file(&path_buf)
}

/// Get the path to the agents directory
#[command]
pub async fn get_agents_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = get_agents_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Copy default command files to the agents directory
fn copy_default_commands(app: &AppHandle, agents_dir: &PathBuf) -> Result<(), String> {
    // Get the resources directory
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("agents");

    // If bundled resources exist, copy them
    if resource_path.exists() {
        copy_dir_recursive(&resource_path, agents_dir)?;
    } else {
        // Create default structure if no bundled resources
        create_default_commands(agents_dir)?;
    }

    Ok(())
}

/// Copy a directory recursively
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst)
            .map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read dir: {}", e))?
        .flatten()
    {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            // Only copy if destination doesn't exist (preserve user modifications)
            if !dst_path.exists() {
                fs::copy(&src_path, &dst_path)
                    .map_err(|e| format!("Failed to copy file: {}", e))?;
            }
        }
    }

    Ok(())
}

/// Create default command files when no bundled resources exist
fn create_default_commands(agents_dir: &PathBuf) -> Result<(), String> {
    // Writing category
    let writing_dir = agents_dir.join("writing");
    fs::create_dir_all(&writing_dir)
        .map_err(|e| format!("Failed to create writing dir: {}", e))?;

    fs::write(
        writing_dir.join("improve.md"),
        r#"---
label: Improve Writing
description: Enhance clarity and flow while preserving voice
model: sonnet
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

You are an expert writing assistant. Improve the selected text by:
1. Enhancing clarity and readability
2. Improving flow and transitions
3. Fixing grammar and punctuation
4. Preserving the author's voice and intent

Return ONLY the improved text, nothing else.
"#,
    )
    .map_err(|e| format!("Failed to write improve.md: {}", e))?;

    fs::write(
        writing_dir.join("proofread.md"),
        r#"---
label: Proofread
description: Fix grammar, spelling, and punctuation errors
model: haiku
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

You are a professional proofreader. Fix all errors in the selected text:
1. Correct grammar mistakes
2. Fix spelling errors
3. Improve punctuation

Make minimal changes - only fix actual errors. Return ONLY the corrected text.
"#,
    )
    .map_err(|e| format!("Failed to write proofread.md: {}", e))?;

    // Translate category
    let translate_dir = agents_dir.join("translate");
    fs::create_dir_all(&translate_dir)
        .map_err(|e| format!("Failed to create translate dir: {}", e))?;

    fs::write(
        translate_dir.join("to-chinese.md"),
        r#"---
label: To Chinese
description: Translate to Simplified Chinese
model: sonnet
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

Translate the selected text to Simplified Chinese. Preserve the original meaning, tone, and style. Return ONLY the translated text.
"#,
    )
    .map_err(|e| format!("Failed to write to-chinese.md: {}", e))?;

    fs::write(
        translate_dir.join("to-english.md"),
        r#"---
label: To English
description: Translate to English
model: sonnet
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

Translate the selected text to English. Preserve the original meaning, tone, and style. Return ONLY the translated text.
"#,
    )
    .map_err(|e| format!("Failed to write to-english.md: {}", e))?;

    // Transform category
    let transform_dir = agents_dir.join("transform");
    fs::create_dir_all(&transform_dir)
        .map_err(|e| format!("Failed to create transform dir: {}", e))?;

    fs::write(
        transform_dir.join("summarize.md"),
        r#"---
label: Summarize
description: Create a concise summary
model: haiku
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

Summarize the selected text concisely. Capture the main points and key ideas. Return ONLY the summary.
"#,
    )
    .map_err(|e| format!("Failed to write summarize.md: {}", e))?;

    fs::write(
        transform_dir.join("expand.md"),
        r#"---
label: Expand
description: Add more detail and examples
model: sonnet
tools:
  - mcp__vmark__selection_get
  - mcp__vmark__selection_replace
---

Expand the selected text with more detail. Add relevant examples, explanations, and context. Maintain the original style. Return ONLY the expanded text.
"#,
    )
    .map_err(|e| format!("Failed to write expand.md: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_to_display_name() {
        assert_eq!(folder_to_display_name("writing"), "Writing");
        assert_eq!(folder_to_display_name("to-chinese"), "To Chinese");
        assert_eq!(folder_to_display_name("my_commands"), "My Commands");
    }

    #[test]
    fn test_filename_to_label() {
        assert_eq!(filename_to_label("improve.md"), "Improve");
        assert_eq!(filename_to_label("to-english.md"), "To English");
    }
}
