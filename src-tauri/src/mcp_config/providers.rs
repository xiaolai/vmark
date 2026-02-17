//! AI provider detection and binary path resolution.
//!
//! Defines the supported AI providers, their config file locations,
//! and the logic to locate the MCP server binary.

use std::path::PathBuf;

/// Provider configuration details
pub(crate) struct ProviderConfig {
    pub name: &'static str,
    pub id: &'static str,
    /// Path relative to `$HOME`. Claude Desktop differs per platform.
    pub relative_path: &'static str,
}

/// Claude Desktop config path per platform:
/// - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
/// - Windows: %APPDATA%/Claude/claude_desktop_config.json  (via dirs::config_dir)
/// - Linux: ~/.config/Claude/claude_desktop_config.json
#[cfg(target_os = "macos")]
const CLAUDE_DESKTOP_PATH: &str = "Library/Application Support/Claude/claude_desktop_config.json";
#[cfg(target_os = "windows")]
const CLAUDE_DESKTOP_PATH: &str = "AppData/Roaming/Claude/claude_desktop_config.json";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const CLAUDE_DESKTOP_PATH: &str = ".config/Claude/claude_desktop_config.json";

pub(crate) const PROVIDERS: &[ProviderConfig] = &[
    ProviderConfig {
        name: "Claude Desktop",
        id: "claude-desktop",
        relative_path: CLAUDE_DESKTOP_PATH,
    },
    ProviderConfig {
        name: "Claude Code",
        id: "claude",
        relative_path: ".claude.json",
    },
    ProviderConfig {
        name: "Codex CLI",
        id: "codex",
        relative_path: ".codex/config.toml",
    },
    ProviderConfig {
        name: "Gemini CLI",
        id: "gemini",
        relative_path: ".gemini/settings.json",
    },
];

pub(crate) fn get_provider_config(provider: &str) -> Result<&'static ProviderConfig, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))
}

pub(crate) fn get_config_path(provider: &ProviderConfig) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(provider.relative_path))
}

fn get_target_triple() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_arch = "aarch64", target_os = "macos"),
        all(target_arch = "x86_64", target_os = "macos"),
        all(target_arch = "x86_64", target_os = "linux"),
        all(target_arch = "x86_64", target_os = "windows"),
    )))]
    {
        "unknown-target"
    }
}

pub(crate) fn get_mcp_binary_path() -> Result<String, String> {
    let binary_name_with_target = format!("vmark-mcp-server-{}", get_target_triple());
    let binary_name_simple = "vmark-mcp-server";

    if cfg!(debug_assertions) {
        // Dev: src-tauri/binaries/vmark-mcp-server-{target}
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let dev_path = PathBuf::from(manifest_dir)
            .join("binaries")
            .join(&binary_name_with_target);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
        // Fallback: try current exe location
    }

    // Production: next to main executable
    let exe = std::env::current_exe().map_err(|e| format!("Cannot get executable path: {}", e))?;
    let exe_dir = exe.parent().ok_or("Cannot get executable directory")?;

    // Cross-platform: try simple name first (Tauri bundles without target suffix)
    // On Windows the binary has .exe extension
    let simple_name = if cfg!(target_os = "windows") {
        format!("{}.exe", binary_name_simple)
    } else {
        binary_name_simple.to_string()
    };
    let simple_path = exe_dir.join(&simple_name);
    if simple_path.exists() {
        return Ok(simple_path
            .canonicalize()
            .unwrap_or(simple_path)
            .to_string_lossy()
            .to_string());
    }

    // macOS only: try Resources folder (alternative bundle location)
    #[cfg(target_os = "macos")]
    {
        let resources_path = exe_dir.join("../Resources").join(&binary_name_with_target);
        if resources_path.exists() {
            return Ok(resources_path
                .canonicalize()
                .unwrap_or(resources_path)
                .to_string_lossy()
                .to_string());
        }
    }

    // Fallback: try next to executable with target suffix
    let prod_path = exe_dir.join(&binary_name_with_target);
    if prod_path.exists() {
        return Ok(prod_path.to_string_lossy().to_string());
    }

    Err(format!(
        "MCP server binary not found: {}. Please reinstall VMark.",
        binary_name_simple
    ))
}
