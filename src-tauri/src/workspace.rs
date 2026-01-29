use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// VS Code-compatible workspace file with VMark namespace extensions.
/// Stored in `.vmark/vmark.code-workspace`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFile {
    /// Workspace folders (VS Code compatible)
    #[serde(default)]
    pub folders: Vec<WorkspaceFolder>,
    /// Settings namespace (VS Code compatible)
    #[serde(default)]
    pub settings: WorkspaceSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceFolder {
    pub path: String,
}

/// Settings block with VMark-namespaced fields
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceSettings {
    /// Folders to exclude from file tree (VMark extension)
    #[serde(rename = "vmark.excludeFolders", default)]
    pub exclude_folders: Vec<String>,
    /// Show hidden files in file explorer (VMark extension)
    #[serde(rename = "vmark.showHiddenFiles", default)]
    pub show_hidden_files: bool,
    /// Last open tabs for session restore (VMark extension)
    #[serde(rename = "vmark.lastOpenTabs", default)]
    pub last_open_tabs: Vec<String>,
    /// AI configuration (VMark extension)
    #[serde(rename = "vmark.ai", default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<serde_json::Value>,
}

impl Default for WorkspaceFile {
    fn default() -> Self {
        Self {
            folders: vec![WorkspaceFolder {
                path: ".".to_string(),
            }],
            settings: WorkspaceSettings {
                exclude_folders: vec![
                    ".git".to_string(),
                    "node_modules".to_string(),
                    ".vmark".to_string(),
                ],
                show_hidden_files: false,
                last_open_tabs: vec![],
                ai: None,
            },
        }
    }
}

/// Legacy workspace configuration (stored in root/.vmark file)
/// Kept for migration purposes only.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyWorkspaceConfig {
    #[serde(default)]
    pub version: u32,
    #[serde(rename = "excludeFolders", default)]
    pub exclude_folders: Vec<String>,
    #[serde(rename = "lastOpenTabs", default)]
    pub last_open_tabs: Vec<String>,
    #[serde(default)]
    pub ai: Option<serde_json::Value>,
}

/// Workspace configuration - the public API type.
/// Maps to/from WorkspaceFile for storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub version: u32,
    #[serde(rename = "excludeFolders")]
    pub exclude_folders: Vec<String>,
    #[serde(rename = "showHiddenFiles", default)]
    pub show_hidden_files: bool,
    #[serde(rename = "lastOpenTabs")]
    pub last_open_tabs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<serde_json::Value>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: 1,
            exclude_folders: vec![
                ".git".to_string(),
                "node_modules".to_string(),
                ".vmark".to_string(),
            ],
            show_hidden_files: false,
            last_open_tabs: vec![],
            ai: None,
        }
    }
}

impl From<WorkspaceFile> for WorkspaceConfig {
    fn from(file: WorkspaceFile) -> Self {
        Self {
            version: 1,
            exclude_folders: file.settings.exclude_folders,
            show_hidden_files: file.settings.show_hidden_files,
            last_open_tabs: file.settings.last_open_tabs,
            ai: file.settings.ai,
        }
    }
}

impl From<WorkspaceConfig> for WorkspaceFile {
    fn from(config: WorkspaceConfig) -> Self {
        Self {
            folders: vec![WorkspaceFolder {
                path: ".".to_string(),
            }],
            settings: WorkspaceSettings {
                exclude_folders: config.exclude_folders,
                show_hidden_files: config.show_hidden_files,
                last_open_tabs: config.last_open_tabs,
                ai: config.ai,
            },
        }
    }
}

impl From<LegacyWorkspaceConfig> for WorkspaceConfig {
    fn from(legacy: LegacyWorkspaceConfig) -> Self {
        Self {
            version: legacy.version,
            exclude_folders: legacy.exclude_folders,
            show_hidden_files: false,
            last_open_tabs: legacy.last_open_tabs,
            ai: legacy.ai,
        }
    }
}

/// Get the path to the new workspace file (.vmark/vmark.code-workspace)
fn get_workspace_file_path(root_path: &Path) -> std::path::PathBuf {
    root_path.join(".vmark").join("vmark.code-workspace")
}

/// Get the path to the legacy config file (.vmark as a file)
fn get_legacy_config_path(root_path: &Path) -> std::path::PathBuf {
    root_path.join(".vmark")
}

/// Check if the legacy .vmark is a file (not a directory)
fn is_legacy_config(root_path: &Path) -> bool {
    let path = get_legacy_config_path(root_path);
    path.exists() && path.is_file()
}

/// Read legacy config from .vmark file
fn read_legacy_config(root_path: &Path) -> Result<Option<LegacyWorkspaceConfig>, String> {
    let config_path = get_legacy_config_path(root_path);

    if !config_path.exists() || !config_path.is_file() {
        return Ok(None);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read legacy .vmark: {e}"))?;

    let config: LegacyWorkspaceConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse legacy .vmark: {e}"))?;

    Ok(Some(config))
}

/// Migrate legacy .vmark file to new .vmark/vmark.code-workspace format.
/// Returns true if migration occurred, false if no migration needed.
fn migrate_legacy_config(root_path: &Path) -> Result<bool, String> {
    if !is_legacy_config(root_path) {
        return Ok(false);
    }

    // Read legacy config
    let legacy = match read_legacy_config(root_path)? {
        Some(c) => c,
        None => return Ok(false),
    };

    // Convert to new format
    let config: WorkspaceConfig = legacy.into();
    let workspace_file: WorkspaceFile = config.into();

    // Ensure .vmark directory exists
    let vmark_dir = root_path.join(".vmark");

    // Rename legacy file to backup before creating directory
    let legacy_path = get_legacy_config_path(root_path);
    let backup_path = root_path.join(".vmark.backup");

    fs::rename(&legacy_path, &backup_path)
        .map_err(|e| format!("Failed to backup legacy .vmark: {e}"))?;

    // Create .vmark directory
    fs::create_dir_all(&vmark_dir)
        .map_err(|e| format!("Failed to create .vmark directory: {e}"))?;

    // Write new workspace file
    let workspace_path = get_workspace_file_path(root_path);
    let content = serde_json::to_string_pretty(&workspace_file)
        .map_err(|e| format!("Failed to serialize workspace: {e}"))?;

    fs::write(&workspace_path, content)
        .map_err(|e| format!("Failed to write workspace file: {e}"))?;

    // Remove backup after successful migration
    let _ = fs::remove_file(&backup_path);

    Ok(true)
}

/// Open folder dialog and return selected path
#[tauri::command]
pub async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_title("Open Folder")
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });

    match rx.recv() {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Dialog error: {e}")),
    }
}

/// Read workspace config, with automatic migration from legacy format.
#[tauri::command]
pub fn read_workspace_config(root_path: &str) -> Result<Option<WorkspaceConfig>, String> {
    let root = Path::new(root_path);

    // Try to migrate legacy config first
    let _ = migrate_legacy_config(root);

    // Read from new location
    let workspace_path = get_workspace_file_path(root);

    if !workspace_path.exists() {
        // Fall back to legacy location for backwards compatibility
        if let Some(legacy) = read_legacy_config(root)? {
            return Ok(Some(legacy.into()));
        }
        return Ok(None);
    }

    let content = fs::read_to_string(&workspace_path)
        .map_err(|e| format!("Failed to read workspace file: {e}"))?;

    let workspace_file: WorkspaceFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace file: {e}"))?;

    Ok(Some(workspace_file.into()))
}

/// Write workspace config to .vmark/vmark.code-workspace
#[tauri::command]
pub fn write_workspace_config(root_path: &str, config: WorkspaceConfig) -> Result<(), String> {
    let root = Path::new(root_path);
    let vmark_dir = root.join(".vmark");

    // Ensure .vmark directory exists
    if !vmark_dir.exists() {
        fs::create_dir_all(&vmark_dir)
            .map_err(|e| format!("Failed to create .vmark directory: {e}"))?;
    }

    let workspace_file: WorkspaceFile = config.into();
    let workspace_path = get_workspace_file_path(root);

    let content = serde_json::to_string_pretty(&workspace_file)
        .map_err(|e| format!("Failed to serialize workspace: {e}"))?;

    fs::write(&workspace_path, content)
        .map_err(|e| format!("Failed to write workspace file: {e}"))?;

    Ok(())
}

/// Check if workspace config exists (in either new or legacy location)
#[tauri::command]
pub fn has_workspace_config(root_path: &str) -> bool {
    let root = Path::new(root_path);
    get_workspace_file_path(root).exists() || is_legacy_config(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_default_workspace_file() {
        let ws = WorkspaceFile::default();
        assert_eq!(ws.folders.len(), 1);
        assert_eq!(ws.folders[0].path, ".");
        assert!(ws.settings.exclude_folders.contains(&".git".to_string()));
        assert!(!ws.settings.show_hidden_files);
    }

    #[test]
    fn test_workspace_config_to_file_roundtrip() {
        let config = WorkspaceConfig {
            version: 1,
            exclude_folders: vec!["test".to_string()],
            show_hidden_files: true,
            last_open_tabs: vec!["file.md".to_string()],
            ai: None,
            identity: None,
        };

        let file: WorkspaceFile = config.clone().into();
        let back: WorkspaceConfig = file.into();

        assert_eq!(back.exclude_folders, config.exclude_folders);
        assert_eq!(back.show_hidden_files, config.show_hidden_files);
        assert_eq!(back.last_open_tabs, config.last_open_tabs);
    }

    #[test]
    fn test_read_nonexistent_workspace() {
        let dir = tempdir().unwrap();
        let result = read_workspace_config(dir.path().to_str().unwrap());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_write_and_read_workspace() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_str().unwrap();

        let config = WorkspaceConfig {
            version: 1,
            exclude_folders: vec!["custom".to_string()],
            show_hidden_files: false,
            last_open_tabs: vec!["doc.md".to_string()],
            ai: None,
            identity: None,
        };

        write_workspace_config(root, config.clone()).unwrap();

        // Verify file was created in new location
        assert!(dir.path().join(".vmark").join("vmark.code-workspace").exists());

        let read = read_workspace_config(root).unwrap().unwrap();
        assert_eq!(read.exclude_folders, config.exclude_folders);
        assert_eq!(read.last_open_tabs, config.last_open_tabs);
    }

    #[test]
    fn test_migrate_legacy_config() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create legacy .vmark file
        let legacy = r#"{
            "version": 1,
            "excludeFolders": ["legacy_folder"],
            "lastOpenTabs": ["old.md"]
        }"#;
        fs::write(root.join(".vmark"), legacy).unwrap();

        // Verify it's detected as legacy
        assert!(is_legacy_config(root));

        // Read should trigger migration
        let config = read_workspace_config(root.to_str().unwrap()).unwrap().unwrap();

        // Verify migration occurred
        assert!(!is_legacy_config(root)); // Legacy file should be gone
        assert!(root.join(".vmark").is_dir()); // .vmark should be a directory now
        assert!(get_workspace_file_path(root).exists()); // New file should exist

        // Verify data was preserved
        assert!(config.exclude_folders.contains(&"legacy_folder".to_string()));
        assert!(config.last_open_tabs.contains(&"old.md".to_string()));
    }

    #[test]
    fn test_has_workspace_config_new_format() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        assert!(!has_workspace_config(root.to_str().unwrap()));

        // Create new format
        fs::create_dir_all(root.join(".vmark")).unwrap();
        fs::write(root.join(".vmark").join("vmark.code-workspace"), "{}").unwrap();

        assert!(has_workspace_config(root.to_str().unwrap()));
    }

    #[test]
    fn test_has_workspace_config_legacy_format() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create legacy format
        fs::write(root.join(".vmark"), "{}").unwrap();

        assert!(has_workspace_config(root.to_str().unwrap()));
    }

    #[test]
    fn test_malformed_legacy_json_error() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create malformed legacy file
        fs::write(root.join(".vmark"), "not valid json").unwrap();

        let result = read_workspace_config(root.to_str().unwrap());
        assert!(result.is_err());
    }
}
