/**
 * terminalSpawnEnv
 *
 * Purpose: Spawn-config helpers for spawnPty — login-shell PATH resolution and
 * per-shell shell-integration config. Extracted to keep spawnPty.ts focused on
 * the spawn lifecycle.
 *
 * Integration contributes ENV AND ARGS, not env alone (WI-3.3): zsh is hooked
 * through ZDOTDIR, but bash has no environment hook that applies to
 * interactive shells and must be spawned as `bash --rcfile <path>`.
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

/** Everything a shell needs at spawn time beyond its executable path. */
export interface ShellSpawnConfig {
  /** The full environment: base env plus any integration overrides. */
  env: Record<string, string>;
  /** Command-line args — `[]` for every shell except bash (`--rcfile`). */
  args: string[];
}

/** The Rust `ShellIntegration` payload (WI-3.3). */
interface ShellIntegrationPayload {
  env?: Record<string, string>;
  args?: string[];
}

/**
 * Build the env AND args for a specific shell, applying shell-integration
 * config to a FRESH copy of the base env (WI-3.1, extended by WI-3.3).
 *
 * The config is shell-specific: zsh gets a `ZDOTDIR` pointing at its rc, bash
 * gets `--rcfile <path>` because it has no environment hook that applies to
 * interactive shells (`BASH_ENV` is non-interactive-only). Applying one
 * shell's config to a different shell would poison its startup, so each shell
 * gets its own.
 *
 * Best-effort — a failure leaves the shell without integration rather than
 * failing the spawn. Returns a copy of `baseEnv` and no args when integration
 * is disabled.
 */
export async function buildShellSpawnConfig(
  baseEnv: Record<string, string>,
  targetShell: string,
  integrationEnabled: boolean,
): Promise<ShellSpawnConfig> {
  const env = { ...baseEnv };
  if (!integrationEnabled) return { env, args: [] };
  try {
    const integration = await invoke<ShellIntegrationPayload | null>(
      "prepare_shell_integration",
      { shell: targetShell },
    );
    if (!integration) return { env, args: [] };
    if (integration.env) Object.assign(env, integration.env);
    // Zero-trust at the IPC boundary: a malformed payload must not become
    // `spawn(shell, undefined)` or inject a non-string into the argv.
    const args = Array.isArray(integration.args)
      ? integration.args.filter((a): a is string => typeof a === "string")
      : [];
    return { env, args };
  } catch {
    // Integration is optional; ignore and spawn without it.
    return { env, args: [] };
  }
}
