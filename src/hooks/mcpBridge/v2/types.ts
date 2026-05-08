/**
 * Purpose: Shared types for the pruned 4-tool MCP surface.
 *
 *   See dev-docs/plans/20260504-mcp-pruning.md for the full ADR set.
 *   These types are exposed as part of the MCP server's public schema —
 *   changes to shape are breaking and must bump the action version.
 *
 * @module hooks/mcpBridge/v2/types
 */

/** Document kind discriminator. Drives which mutation tool applies. */
export type DocumentKind = "markdown" | "yaml-workflow";

/** Tab info returned in session.get_state. */
export interface SessionTab {
  id: string;
  filePath: string | null;
  title: string;
  dirty: boolean;
  /** Per-document revision token (currently shares the global revision). */
  revision: string;
  kind: DocumentKind;
}

export interface SessionWindow {
  label: string;
  focused: boolean;
  tabs: SessionTab[];
}

export interface SessionCapabilities {
  /** App version — sourced from package.json. */
  version: string;
  /** Discriminator values supported by `document.transform` / mutation tools. */
  supportedKinds: DocumentKind[];
  /** MCP protocol version (distinct from app version). */
  mcpProtocol: string;
}

export interface SessionState {
  windows: SessionWindow[];
  capabilities: SessionCapabilities;
}

/** Standard error codes used across the four-tool surface. */
export type V2ErrorCode =
  | "STALE"
  | "INVALID_PATCH"
  | "INVALID_TAB"
  | "INVALID_PATH"
  | "READ_ONLY"
  | "NOT_WORKFLOW"
  | "NO_EDITOR"
  | "INTERNAL";

export interface V2Error {
  error: V2ErrorCode;
  message: string;
  /** Optional payload — populated by STALE responses with the up-to-date revision. */
  current_revision?: string;
}

/**
 * Construct a V2 error envelope.
 *
 * The bridge protocol carries `success: false` + `error: string`; we
 * encode the structured error as a JSON string in `error` so callers
 * can parse the code without changing the wire format.
 */
export function v2ErrorString(err: V2Error): string {
  return JSON.stringify(err);
}
