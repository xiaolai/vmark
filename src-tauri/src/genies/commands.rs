//! Tauri commands for the genies feature.

use super::parsing::parse_genie;
use super::scanning::scan_genies_dir;
use super::types::{GenieContent, GenieEntry, GenieIoSpec, GenieMetadata};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

/// Return the global genies directory path.
pub fn global_genies_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join("genies"))
}

/// Return the global genies directory path (Tauri command).
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
///
/// Markdown genies parse as before (frontmatter → metadata + template body).
/// YAML workflow genies (`.yml`/`.yaml`) parse the top-level `name` and
/// `description` for picker display; the `template` field carries the full
/// raw YAML so the runner can submit it via `run_workflow`. WI-7.1.
///
/// Validates the path is within the global genies directory to prevent
/// traversal.
#[command]
pub fn read_genie(app: AppHandle, path: String) -> Result<GenieContent, String> {
    // Canonicalize requested path
    let requested = fs::canonicalize(&path)
        .map_err(|e| format!("Invalid genie path {}: {}", path, e))?;

    // Validate path is within the global genies directory
    let global_dir = fs::canonicalize(global_genies_dir(&app)?)
        .map_err(|e| format!("Genies directory does not exist or is inaccessible: {}", e))?;

    if !requested.starts_with(&global_dir) {
        return Err(rust_i18n::t!("errors.genie.pathBlocked").to_string());
    }

    let content = fs::read_to_string(&requested)
        .map_err(|e| format!("Failed to read genie file {}: {}", path, e))?;

    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("yml") | Some("yaml") => parse_workflow_genie(&content, &path),
        _ => parse_genie(&content, &path),
    }
}

/// Build a `GenieContent` for a YAML workflow genie. Top-level `name` becomes
/// the description (filename is the canonical display name); the body is the
/// full YAML so the runner can submit it.
fn parse_workflow_genie(content: &str, path: &str) -> Result<GenieContent, String> {
    let value: serde_yaml::Value = serde_yaml::from_str(content)
        .map_err(|e| format!("Failed to parse YAML genie {}: {}", path, e))?;
    let map = value.as_mapping();
    let description = map
        .and_then(|m| m.get(serde_yaml::Value::String("description".to_string())))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // The `name` from the YAML is shown as the secondary description if no
    // `description:` is present, so workflow authors who use `name:` for the
    // human-readable label still get something in the picker.
    let description = if description.is_empty() {
        map.and_then(|m| m.get(serde_yaml::Value::String("name".to_string())))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        description
    };

    let name = Path::new(path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(GenieContent {
        metadata: GenieMetadata {
            name,
            description,
            // Workflow genies declare scope on their YAML steps, not at the
            // file level — the picker treats them as document-scoped by
            // default so they can run regardless of editor selection state.
            scope: "document".to_string(),
            category: None,
            model: None,
            action: None,
            context: None,
            approval: None,
            // Reuse the v1 marker so the frontend dispatcher can branch on it.
            version: Some("workflow".to_string()),
            input: Some(GenieIoSpec {
                io_type: "workflow".to_string(),
                accept: None,
                description: None,
                schema: None,
            }),
            output: None,
            tags: None,
        },
        template: content.to_string(),
    })
}
