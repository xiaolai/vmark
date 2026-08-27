/**
 * terminalSpawnEnv
 *
 * Purpose: Spawn-config helpers for spawnPty — the base environment every
 * terminal session gets, login-shell PATH resolution, and per-shell
 * shell-integration config. Extracted to keep spawnPty.ts focused on the spawn
 * lifecycle.
 *
 * Integration contributes ENV AND ARGS, not env alone (WI-3.3): zsh is hooked
 * through ZDOTDIR, but bash has no environment hook that applies to
 * interactive shells and must be spawned as `bash --rcfile <path>`.
 *
 * @coordinates-with spawnPty.ts — sole caller
 * @module components/Terminal/terminalSpawnEnv
 */
import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "@/utils/platform";

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
 * The environment every terminal session starts from, before shell integration
 * layers its own overrides on top. `CommandBuilder` on the Rust side sets these
 * OVER the inherited process environment rather than replacing it, so anything
 * absent here is whatever the user's desktop session already exported.
 *
 * What is here and why:
 *
 *   - `TERM=xterm-256color` — Tauri GUI apps may inherit no terminal env at
 *     all, so state the colour capability xterm.js actually has.
 *   - `TERM_PROGRAM=WezTerm` — impersonation, so CLI tools with terminal
 *     allowlists (Claude Code's `/terminal-setup`, etc.) recognize the host as
 *     a CSI-u-capable terminal. WezTerm has the lowest side-effect risk of the
 *     four recognized values. See
 *     dev-docs/decisions/ADR-006-terminal-program-identity.md. Do NOT change
 *     this to "vmark" — third-party tools fall through to a degraded "unknown
 *     terminal" path. terminalKeyHandler.ts keeps the impersonation honest by
 *     translating Shift+Enter into the CSI-u sequence real WezTerm sends.
 *   - `COLORTERM=truecolor` — xterm.js renders SGR 38;2;r;g;b, but with
 *     COLORTERM empty a CLI tool has no way to know that and downgrades to the
 *     256-colour palette (#1334).
 *   - `PATH` — the login shell's PATH, so node/claude/etc. are discoverable.
 *     macOS GUI apps launched from the Dock have a minimal PATH.
 *   - `LC_CTYPE=UTF-8`, **macOS only** — a GUI app there inherits almost no
 *     environment, and without this the shell falls back to the C locale and
 *     tools emit "?" for CJK. LC_CTYPE rather than LANG, so only the encoding
 *     is affected and the user's full locale is left alone.
 *
 *     The macOS gate is the fix for #1334: the bare name "UTF-8" is a locale on
 *     Darwin (/usr/share/locale/UTF-8) and is NOT one on glibc. Exporting it on
 *     Linux replaced a perfectly good inherited locale with an invalid one, so
 *     every child calling setlocale() failed — "locale: Cannot set LC_CTYPE to
 *     default locale: No such file or directory", plus `manpath: can't set the
 *     locale` on every prompt. Off macOS the session's own LANG/LC_* are
 *     inherited, which is already correct.
 *   - `VMARK_WORKSPACE` — the workspace root, when one is open, so shell
 *     scripts can find it.
 *
 * `EDITOR` is deliberately ABSENT (T1/D1). It used to be forced to "vmark" on
 * every platform, which could never work: the `vmark` shim is opt-in,
 * macOS-only and admin-gated, so the default state is `vmark: command not
 * found`; and even when installed it runs `open -b app.vmark "$@"` without
 * `-W`, returning immediately, so `git commit` aborts with "empty commit
 * message". Leaving it unset lets the user's login-shell value win. Restoring
 * it needs a real blocking `vmark --wait` protocol — tracked separately.
 */
export function buildBaseTerminalEnv(
  loginPath: string,
  workspaceRoot: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {
    TERM: "xterm-256color",
    TERM_PROGRAM: "WezTerm",
    COLORTERM: "truecolor",
    PATH: loginPath,
  };
  if (isMacPlatform()) env.LC_CTYPE = "UTF-8";
  if (workspaceRoot) env.VMARK_WORKSPACE = workspaceRoot;
  return env;
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
