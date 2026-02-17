//! MCP Configuration types.
//!
//! Data structures for provider status, config previews, install/uninstall results,
//! and diagnostics.

use serde::{Deserialize, Serialize};

/// Status of a single AI provider configuration
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub provider: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    #[serde(rename = "hasVmark")]
    pub has_vmark: bool,
}

/// Preview of config changes before installation
#[derive(Clone, Serialize, Deserialize)]
pub struct ConfigPreview {
    pub provider: String,
    pub path: String,
    #[serde(rename = "binaryPath")]
    pub binary_path: String,
    #[serde(rename = "isDev")]
    pub is_dev: bool,
    #[serde(rename = "currentContent")]
    pub current_content: Option<String>,
    #[serde(rename = "proposedContent")]
    pub proposed_content: String,
    #[serde(rename = "backupPath")]
    pub backup_path: String,
}

/// Result of config installation
#[derive(Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    #[serde(rename = "backupPath")]
    pub backup_path: Option<String>,
}

/// Result of config uninstallation
#[derive(Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub success: bool,
    pub message: String,
}

/// Diagnostic status for MCP configuration
#[derive(Clone, Serialize, Deserialize)]
pub enum DiagnosticStatus {
    /// Config exists, path matches, binary exists
    Valid,
    /// Binary path in config doesn't match expected
    PathMismatch,
    /// Binary file doesn't exist on disk
    BinaryMissing,
    /// No vmark entry in config
    NotConfigured,
}

/// Detailed diagnostic information for a provider
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderDiagnostic {
    pub provider: String,
    pub name: String,
    #[serde(rename = "configPath")]
    pub config_path: String,
    #[serde(rename = "configExists")]
    pub config_exists: bool,
    #[serde(rename = "hasVmark")]
    pub has_vmark: bool,
    #[serde(rename = "expectedBinaryPath")]
    pub expected_binary_path: Option<String>,
    #[serde(rename = "configuredBinaryPath")]
    pub configured_binary_path: Option<String>,
    #[serde(rename = "binaryExists")]
    pub binary_exists: bool,
    pub status: DiagnosticStatus,
    pub message: String,
}
