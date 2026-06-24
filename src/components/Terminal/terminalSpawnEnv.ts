/**
 * terminalSpawnEnv
 *
 * Purpose: Environment helpers for spawnPty — login-shell PATH resolution and
 * per-shell shell-integration override application. Extracted to keep
 * spawnPty.ts focused on the spawn lifecycle.
 *
 * @coordinates-with spawnPty.ts — sole caller
 * @module components/Terminal/terminalSpawnEnv
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Fetch the login shell PATH so CLI tools (node, claude, etc.) are
 * discoverable — macOS GUI apps have minimal PATH. Falls back to a
 * platform-appropriate default when IPC fails or returns empty.
 */
export async function resolveLoginShellPath(): Promise<string> {
  let loginPath: string;
  try {
    loginPath = await invoke<string>("get_login_shell_path");
  } catch {
    loginPath = "";
  }
  if (loginPath) return loginPath;
  // navigator.platform is deprecated but still reliable for this check.
  const isWindows = navigator.platform.startsWith("Win");
  return isWindows
    ? "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0"
    : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
}

/**
 * Build the env for a specific shell, applying shell-integration overrides to
 * a FRESH copy of the base env (WI-3.1). The overrides are shell-specific
 * (e.g. ZDOTDIR points at a zsh rc); applying one shell's overrides to a
 * different shell would poison its startup, so each shell gets its own env.
 * Best-effort — a failure leaves the env without integration. Returns a copy
 * of `baseEnv` unchanged when integration is disabled.
 */
export async function buildShellEnv(
  baseEnv: Record<string, string>,
  targetShell: string,
  integrationEnabled: boolean,
): Promise<Record<string, string>> {
  const shellEnv = { ...baseEnv };
  if (!integrationEnabled) return shellEnv;
  try {
    const overrides = await invoke<Record<string, string> | null>(
      "prepare_shell_integration",
      { shell: targetShell },
    );
    if (overrides) Object.assign(shellEnv, overrides);
  } catch {
    // Integration is optional; ignore and spawn without it.
  }
  return shellEnv;
}
