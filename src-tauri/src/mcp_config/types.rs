//! MCP Configuration types.
//!
//! Data structures for provider status, config previews, install/uninstall results,
//! and diagnostics.

use serde::{Deserialize, Serialize};

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

/// Result of MCP config installation (success, message, optional backup path).
#[derive(Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    #[serde(rename = "backupPath")]
    pub backup_path: Option<String>,
}

/// Result of MCP config uninstallation (success and message).
#[derive(Clone, Serialize, Deserialize)]
pub struct UninstallResult {
    pub success: bool,
    pub message: String,
    /// Whether an entry was actually removed, as opposed to there having been
    /// nothing to remove.
    ///
    /// `message` already encodes this, but only in prose — the settings panel
    /// needs it as data so it can render the outcome in the user's language
    /// instead of echoing an English sentence from the backend.
    pub changed: bool,
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
    /// The config file is there, but VMark cannot read or parse it — so
    /// whether it holds a vmark entry is unknown, not "no".
    ///
    /// Distinct from `NotConfigured` because the two need opposite advice.
    /// `NotConfigured` means "click Install"; this means "your file is
    /// broken, fix it first" — and the install path will (correctly) refuse
    /// it, so offering Install here walks the user into a dead end.
    ConfigUnreadable,
}

/// Detailed diagnostic information for a provider
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderDiagnostic {
    pub provider: String,
    pub name: String,
    /// A discontinued tool (Gemini CLI). The panel shows such a row only
    /// because a vmark entry is still in its config, and offers removal only.
    pub legacy: bool,
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
