//! Shell integration setup (WI-3.1).
//!
//! Purpose: Materializes the per-shell integration rc that emits OSC 133
//! command-boundary marks + OSC 7 cwd, and returns the environment overrides
//! the frontend should apply when spawning the shell. Currently zsh-only
//! (macOS primary, per the WI-0.3 spike); other shells return `None` and the
//! terminal spawns without integration (graceful degrade).
//!
//! The zsh script is embedded at compile time via `include_str!`, so there is
//! no runtime resource bundling. It is written to
//! `<appLocalData>/shell-integration/zsh/.zshrc` and pointed at by `ZDOTDIR`.
//!
//! @coordinates-with lib.rs — command registered in generate_handler![]
//! @coordinates-with src/components/Terminal/spawnPty.ts — applies the env overrides
//! @module shell_integration

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// Per-process counter for unique temp filenames (avoids concurrent-spawn races).
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// zsh integration rc, embedded at compile time.
const ZSH_INTEGRATION: &str = include_str!("../resources/shell-integration/vmark.zsh");

/// Extract the executable basename from a shell path (`/bin/zsh` → `zsh`).
fn shell_basename(shell: &str) -> &str {
    std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
}

/// Prepare shell integration for `shell`. Returns env overrides to apply at
/// spawn (e.g. `ZDOTDIR`), or `None` for shells without integration support.
#[tauri::command]
pub async fn prepare_shell_integration<R: Runtime>(
    shell: String,
    app: AppHandle<R>,
) -> Result<Option<BTreeMap<String, String>>, String> {
    if shell_basename(&shell) != "zsh" {
        // bash (--rcfile) and fish (conf.d) follow in a later WI; unknown shells
        // never get integration.
        return Ok(None);
    }

    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let dir = base.join("shell-integration").join("zsh");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create integration dir: {e}"))?;
    // Atomic write: a concurrent spawn could otherwise source a half-written
    // .zshrc. Write a per-call unique temp file then rename (atomic on the same
    // filesystem). A unique name keeps two concurrent calls from clobbering each
    // other's temp file before the rename.
    let rc = dir.join(".zshrc");
    let tmp = dir.join(format!(
        ".zshrc.tmp.{}.{}",
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed),
    ));
    std::fs::write(&tmp, ZSH_INTEGRATION)
        .map_err(|e| format!("Failed to write integration rc: {e}"))?;
    std::fs::rename(&tmp, &rc)
        .map_err(|e| format!("Failed to install integration rc: {e}"))?;

    let mut env = BTreeMap::new();
    env.insert("ZDOTDIR".to_string(), dir.to_string_lossy().into_owned());
    Ok(Some(env))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_basename_extracts_name() {
        assert_eq!(shell_basename("/bin/zsh"), "zsh");
        assert_eq!(shell_basename("/usr/local/bin/zsh"), "zsh");
        assert_eq!(shell_basename("/bin/bash"), "bash");
        assert_eq!(shell_basename("zsh"), "zsh");
        assert_eq!(shell_basename(""), "");
    }

    #[test]
    fn embedded_script_has_the_osc_marks() {
        // Guards against an empty/garbled include_str! and documents the contract.
        assert!(ZSH_INTEGRATION.contains("133;A"));
        assert!(ZSH_INTEGRATION.contains("133;C"));
        assert!(ZSH_INTEGRATION.contains("133;D"));
        assert!(ZSH_INTEGRATION.contains("add-zsh-hook"));
        // Non-destructive: sources the user's real rc.
        assert!(ZSH_INTEGRATION.contains("source \"$ZDOTDIR/.zshrc\""));
    }
}
