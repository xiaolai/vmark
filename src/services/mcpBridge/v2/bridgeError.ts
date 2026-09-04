/**
 * bridgeError — the ONE renderer for a handler failure on the MCP bridge.
 *
 * Purpose: every v2 handler funnels thrown errors through `wrapHandler`, and until
 * this module existed the wrapper rendered them with `String(error)`. A Rust
 * `CommandError` is a plain object, so every typed refusal — a stale generation,
 * a spent attachment, a script over the size cap — reached the AI client as the
 * literal text "[object Object]" with its `detail.mcpCode` token lost. The
 * `check-command-error-ratchet` gate could not see it: the `invoke()` lived in the
 * handler and the stringify in the wrapper, and the gate is file-level by design.
 *
 * The envelope carries the token FIRST in the text (`STALE_COMMAND: …`), because
 * the token is what shipped clients match on, and repeats it structurally in
 * `data` so a client that prefers fields to prefixes has them too.
 *
 * @coordinates-with services/mcpBridge/v2/wrapHandler — the only caller on the throw path
 * @coordinates-with services/mcpBridge/v2/browserFailure — the navigation handlers' token helper
 * @coordinates-with services/commands/commandError — the wire shape parser
 * @module services/mcpBridge/v2/bridgeError
 */
import { commandErrorMessage, parseCommandError } from "@/services/commands/commandError";

export interface BridgeErrorEnvelope {
  /** `TOKEN: message` for a typed error; the message alone otherwise. */
  error: string;
  /** Present only for a typed error: the machine-readable half of the refusal. */
  data?: {
    code: string;
    token: string;
    mcpCode?: string;
    detail?: Record<string, unknown>;
  };
}

/**
 * The token the MCP client sees for a typed error: Rust's `detail.mcpCode` when it
 * set one (the MCP protocol's finer vocabulary), else the error class in
 * UPPER_SNAKE. `null` for anything that is not a typed error.
 */
export function bridgeErrorToken(error: unknown): string | null {
  const parsed = parseCommandError(error);
  if (!parsed) return null;
  const mcpCode = parsed.detail?.mcpCode;
  if (typeof mcpCode === "string" && mcpCode.length > 0) return mcpCode;
  return parsed.code.toUpperCase().replace(/-/g, "_");
}

/** Render any thrown value as the failure envelope a `respond()` can carry. */
export function bridgeErrorEnvelope(error: unknown): BridgeErrorEnvelope {
  const parsed = parseCommandError(error);
  if (parsed) {
    const token = bridgeErrorToken(error) as string;
    const mcpCode = parsed.detail?.mcpCode;
    return {
      error: `${token}: ${parsed.message}`,
      data: {
        code: parsed.code,
        token,
        ...(typeof mcpCode === "string" ? { mcpCode } : {}),
        ...(parsed.detail ? { detail: parsed.detail } : {}),
      },
    };
  }
  return { error: commandErrorMessage(error) };
}
