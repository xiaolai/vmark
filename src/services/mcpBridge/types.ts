/**
 * MCP Bridge Types
 *
 * Purpose: TypeScript interfaces for the MCP bridge request/response protocol —
 *   defines the shape of events flowing between Rust and frontend handlers.
 *
 * @module services/mcpBridge/types
 */

/**
 * The credential-derived identity of a bridge connection — the wire twin of
 * Rust's `BridgePrincipal` (`mcp_bridge/attribution.rs` `PrincipalWire`).
 * Four states, never collapsed: each failure to identify has its own cause.
 */
export type McpPrincipal =
  | { readonly kind: "anonymous" }
  | { readonly kind: "unrecognized" }
  | { readonly kind: "ambiguous"; readonly providers: readonly string[] }
  | { readonly kind: "provider"; readonly providerId: string };

/**
 * Who sent a request. `principal` and `connectionId` are established by
 * VMark; `sessionLabel` and `displayName` are what the client SAYS about
 * itself — untrusted, for display and grouping only.
 */
export interface McpAttribution {
  readonly principal: McpPrincipal;
  /** Lower-case hyphenated UUID minted per authenticated connection. */
  readonly connectionId: string;
  /** From `identify`; at most 128 UTF-8 bytes. */
  readonly sessionLabel: string | null;
  /** From `identify` (name and version). */
  readonly displayName: string | null;
}

/** Raw event from Tauri IPC - args is JSON string to avoid double-encoding */
export interface McpRequestEventRaw {
  id: string;
  type: string;
  /** Snake case (as defined in Rust) */
  args_json?: string;
  /** CamelCase (Tauri might convert) */
  argsJson?: string;
  /** Unvalidated; read only through `parseMcpAttribution`. */
  attribution?: unknown;
}

/** Parsed event with args as object */
export interface McpRequestEvent {
  id: string;
  type: string;
  args: Record<string, unknown>;
  /** Validated and frozen; the seed of a request's write context. */
  attribution: McpAttribution;
}

/** Response sent back to Rust after an MCP bridge handler completes. */
export interface McpResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
