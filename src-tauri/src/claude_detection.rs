//! Claude Code Detection
//!
//! Detects if Claude Code CLI is installed and accessible.

use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;
use which::which;

/// Status of Claude Code installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Detect if Claude Code is installed
#[command]
pub async fn detect_claude_code() -> Result<ClaudeCodeStatus, String> {
    // Try to find claude in PATH
    match which("claude") {
        Ok(path) => {
            let path_str = path.to_string_lossy().to_string();

            // Try to get version
            let version = match Command::new(&path).arg("--version").output() {
                Ok(output) if output.status.success() => {
                    let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if version_str.is_empty() {
                        None
                    } else {
                        Some(version_str)
                    }
                }
                _ => None,
            };

            Ok(ClaudeCodeStatus {
                installed: true,
                version,
                path: Some(path_str),
            })
        }
        Err(_) => Ok(ClaudeCodeStatus {
            installed: false,
            version: None,
            path: None,
        }),
    }
}

/// Get the path to claude executable
#[command]
pub async fn get_claude_path() -> Result<Option<String>, String> {
    match which("claude") {
        Ok(path) => Ok(Some(path.to_string_lossy().to_string())),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_detect_claude_code() {
        // This test will pass whether or not claude is installed
        let result = detect_claude_code().await;
        assert!(result.is_ok());
    }
}
