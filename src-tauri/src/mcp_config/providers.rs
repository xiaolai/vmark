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
    /// A tool VMark no longer targets. A legacy provider appears in
    /// diagnostics only while its config still holds a vmark entry, and the
    /// only action offered is removal — install and preview refuse it.
    pub legacy: bool,
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
        legacy: false,
    },
    ProviderConfig {
        name: "Claude Code",
        id: "claude",
        relative_path: ".claude.json",
        legacy: false,
    },
    ProviderConfig {
        name: "Codex CLI",
        id: "codex",
        relative_path: ".codex/config.toml",
        legacy: false,
    },
    // Antigravity CLI (`agy`) is Google's successor to Gemini CLI. It keeps
    // the `.gemini` directory but reads MCP servers from its own file, in the
    // same `mcpServers` JSON shape.
    ProviderConfig {
        name: "Antigravity CLI",
        id: "antigravity",
        relative_path: ".gemini/config/mcp_config.json",
        legacy: false,
    },
    // xAI's Grok CLI (`xai-org/grok-build`). Its `[mcp_servers.<name>]` TOML
    // is the same shape Codex reads.
    ProviderConfig {
        name: "Grok CLI",
        id: "grok",
        relative_path: ".grok/config.toml",
        legacy: false,
    },
    // opencode deep-merges `config.json`, `opencode.json` and `opencode.jsonc`
    // in its global config dir, so writing plain JSON to `opencode.json` is
    // additive even for a user whose own settings live in `opencode.jsonc` —
    // which VMark could not round-trip (serde_json does not parse comments).
    ProviderConfig {
        name: "opencode",
        id: "opencode",
        relative_path: ".config/opencode/opencode.json",
        legacy: false,
    },
    // Gemini CLI is discontinued (replaced by Antigravity). Kept only so a
    // machine that still carries a vmark entry from an earlier install gets a
    // removal path in the Integrations panel.
    ProviderConfig {
        name: "Gemini CLI",
        id: "gemini",
        relative_path: ".gemini/settings.json",
        legacy: true,
    },
];

pub(crate) fn get_provider_config(provider: &str) -> Result<&'static ProviderConfig, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == provider)
        .ok_or_else(|| rust_i18n::t!("errors.mcp.unknownProvider", provider = provider).to_string())
}

pub(crate) fn get_config_path(provider: &ProviderConfig) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| rust_i18n::t!("errors.mcp.noHomeDir").to_string())?;
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

/// Present a canonical path the way third-party tools expect it.
///
/// `canonicalize()` returns a Windows extended-length (verbatim) path —
/// `\\?\C:\…`, or `\\?\UNC\server\share` for a network path. That string
/// is not internal: it is written into the `command` field of Claude's,
/// Codex's and Gemini's config files and into the `ccswitch://v1/import`
/// payload, where consumers do not recognise the prefix (#1202).
///
/// Always compiled — a no-op on Unix, whose paths never carry the prefix — so
/// the rule is unit-tested on every platform rather than only on Windows CI.
/// Mirrors `workspace_validation::strip_verbatim_prefix`, which does the same
/// for the frontend; the two stay separate because they are different
/// boundaries and neither module should depend on the other.
fn display_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        path.to_owned()
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
            return Ok(display_path(&dev_path.to_string_lossy()));
        }
        // Fallback: try current exe location
    }

    // Production: next to main executable
    let exe = std::env::current_exe().map_err(|e| {
        rust_i18n::t!("errors.mcp.exePathFailed", detail = e.to_string()).to_string()
    })?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| rust_i18n::t!("errors.mcp.exeDirFailed").to_string())?;

    // Cross-platform: try simple name first (Tauri bundles without target suffix)
    // On Windows the binary has .exe extension
    let simple_name = if cfg!(target_os = "windows") {
        format!("{}.exe", binary_name_simple)
    } else {
        binary_name_simple.to_string()
    };
    let simple_path = exe_dir.join(&simple_name);
    if simple_path.exists() {
        return Ok(display_path(
            &simple_path
                .canonicalize()
                .unwrap_or(simple_path)
                .to_string_lossy(),
        ));
    }

    // macOS only: try Resources folder (alternative bundle location)
    #[cfg(target_os = "macos")]
    {
        let resources_path = exe_dir.join("../Resources").join(&binary_name_with_target);
        if resources_path.exists() {
            return Ok(display_path(
                &resources_path
                    .canonicalize()
                    .unwrap_or(resources_path)
                    .to_string_lossy(),
            ));
        }
    }

    // Fallback: try next to executable with target suffix
    let prod_path = exe_dir.join(&binary_name_with_target);
    if prod_path.exists() {
        return Ok(display_path(&prod_path.to_string_lossy()));
    }

    Err(rust_i18n::t!("errors.mcp.binaryNotFound", name = binary_name_simple).to_string())
}

#[cfg(test)]
#[path = "providers.test.rs"]
mod providers_test;
