/**
 * Who this sidecar is — the credential it holds, and the label it reports.
 *
 * Two things live here because they are the same question answered two ways,
 * and the difference between them is the whole point:
 *
 * - `readClientToken` returns the credential VMark minted and wrote into this
 *   AI client's own MCP config at install time. VMark **verifies** it, and the
 *   bridge's authorization principal is bound to it.
 * - `detectClientIdentity` GUESSES a name from environment variables and the
 *   parent process name. VMark uses it as a display label only. It is a
 *   heuristic — a wrapper script or a renamed binary changes the answer — and
 *   it used to be what authorization was bound to, which meant a shell alias
 *   could put the wrong actor in an audit receipt (audit 20260728 §2.1).
 *
 * Both take their inputs as parameters rather than reading globals, so the
 * detection rules are testable without mutating `process.env`.
 *
 * @coordinates-with bridge/connection.ts (sends both in the auth/identify
 *   frames), src-tauri/src/mcp_config/client_token_field.rs (writes the
 *   credential), src-tauri/src/mcp_bridge/principal.rs (verifies it)
 */

import { getParentProcessName } from './parentProcess.js';
import type { ClientIdentity } from '../bridge/websocketConfig.js';

/**
 * The environment variable carrying this client's VMark credential.
 * Mirrored in `src-tauri/src/mcp_config/client_token_field.rs`.
 */
export const CLIENT_TOKEN_ENV = 'VMARK_MCP_TOKEN';

/**
 * Read the per-client credential from the environment.
 *
 * Absent is normal and not an error: installs that predate this mechanism
 * have no `env` block, and the sidecar still connects with the shared bridge
 * token from the port file. It is simply not identified, so only delegated
 * actions (`coherence.resolve`) are refused — with an error that says to
 * re-run Install for this client.
 *
 * A blank value is treated as absent for the same reason VMark does: an empty
 * credential must not be presented as one.
 */
export function readClientToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env[CLIENT_TOKEN_ENV]?.trim();
  return token ? token : undefined;
}

/** Everything the detection heuristic looks at. */
export interface IdentityInputs {
  env: NodeJS.ProcessEnv;
  /** `undefined` when the parent process could not be named. */
  parentProcess: string | undefined;
  pid: number;
}

/** Read the inputs from the live process. */
export function currentIdentityInputs(): IdentityInputs {
  return {
    env: process.env,
    parentProcess: getParentProcessName(),
    pid: process.pid,
  };
}

/**
 * Guess which AI client spawned this sidecar, for display only.
 *
 * The rules moved out of `cli.ts` unchanged. What changed is the shape: the
 * inputs arrive as one object so every branch is reachable in a test without
 * touching the real process, and so `parentProcess: undefined` means what it
 * says. Per-parameter defaults could not express that — an explicit
 * `undefined` triggers the default and would have gone and asked the OS.
 */
export function detectClientIdentity(
  inputs: IdentityInputs = currentIdentityInputs(),
): ClientIdentity {
  const { env, parentProcess, pid } = inputs;
  // Check for Claude Code (sets CLAUDE_CODE_VERSION or similar env vars)
  if (env.CLAUDE_CODE_ENTRYPOINT || parentProcess?.includes('claude')) {
    return {
      name: 'claude-code',
      version: env.CLAUDE_CODE_VERSION,
      pid,
      parentProcess,
    };
  }

  // Check for Codex CLI
  if (env.CODEX_HOME || parentProcess?.includes('codex')) {
    return {
      name: 'codex-cli',
      version: env.CODEX_VERSION,
      pid,
      parentProcess,
    };
  }

  // Check for Cursor
  if (parentProcess?.toLowerCase().includes('cursor')) {
    return { name: 'cursor', pid, parentProcess };
  }

  // Check for Windsurf
  if (parentProcess?.toLowerCase().includes('windsurf')) {
    return { name: 'windsurf', pid, parentProcess };
  }

  // Unknown client - use parent process name if available
  return { name: parentProcess || 'unknown', pid, parentProcess };
}
