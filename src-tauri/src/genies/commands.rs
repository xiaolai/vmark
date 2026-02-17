//! Tauri commands for the genies feature.

use super::parsing::parse_genie;
use super::scanning::scan_genies_dir;
use super::types::{GenieContent, GenieEntry};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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
