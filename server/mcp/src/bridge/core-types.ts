/**
 * Core bridge types for communication between the MCP server and VMark.
 *
 * The pruned tool surface exposes six MCP tool namespaces (session, workspace,
 * document, workflow, selection, browser); BridgeRequest is the union of the
 * individual `vmark.*` (tool, action) request variants they emit. The Rust
 * bridge parser extracts `type` as the request_type and forwards every other
 * key as args, so all extra fields here are flat (not nested under `args`).
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md
 */

/**
 * MCP bridge protocol version this server speaks. Sent to VMark on
 * `session.get_state` so the app can gate protocol-versioned data (browser tabs
 * arrived at 0.3.0). Bump in lockstep with the app's MCP_PROTOCOL_VERSION.
 */
export const MCP_PROTOCOL_VERSION = '0.3.0';

/**
 * Bridge request types — every command the MCP server can send.
 *
 * GENERATED from `operationSchemas.ts`, which is the one declaration of the
 * payload contract (WI-15). This used to be a hand-written union kept in step
 * with the Rust pass-through and the webview's `typeof` narrowing by nothing
 * but care; `pnpm lint:mcp-contracts` now proves the copies agree.
 */
import type { BridgeRequest } from './generated/bridgeRequests.js';

export type { BridgeRequest };

/**
 * Bridge response types — what VMark returns.
 *
 * The `error` field carries either a free-form message (legacy) or a
 * JSON-stringified V2Error envelope ({error, message, current_revision?}).
 * Tools parse opportunistically.
 *
 * A failure MAY carry `data`. The browser approval gate (R5) is the reason: a
 * refused action is not simply an error — it is a request for human consent, and
 * the AI needs the structured envelope (`needsApproval`, `operation`, `url`) to
 * explain what it wants to do. Modelling that as an error-only failure meant
 * `sendBridgeRequest` threw `new Error(undefined)` and the AI learned nothing.
 */
export interface NeedsApproval {
  needsApproval: true;
  operation: string;
  url: string;
  tabId?: string;
  generation?: number;
}

/**
 * Is `data` the browser approval envelope?
 *
 * Validates the full contract, not just the discriminant: consumers render
 * `operation` and `url` directly, so a truthy-but-malformed `{needsApproval:true}`
 * must NOT pass — it would produce guidance like `'undefined' on undefined` and
 * swallow the real error. Empty strings are rejected too (a blank operation/url
 * is not actionable guidance).
 */
export function isNeedsApproval(data: unknown): data is NeedsApproval {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as {
    needsApproval?: unknown;
    operation?: unknown;
    url?: unknown;
    tabId?: unknown;
    generation?: unknown;
  };
  return (
    d.needsApproval === true &&
    typeof d.operation === 'string' &&
    d.operation.length > 0 &&
    typeof d.url === 'string' &&
    d.url.length > 0 &&
    (d.tabId === undefined || (typeof d.tabId === 'string' && d.tabId.length > 0)) &&
    (d.generation === undefined || (typeof d.generation === 'number' && Number.isInteger(d.generation)))
  );
}

/**
 * Bridge response. Generic in the success payload so callers get an honest type:
 * on success `data` is `T`; on failure `data` is optional and untyped (it carries
 * the browser approval envelope, never the success payload). The previous
 * `BridgeResponse & { data: T }` intersection made failure `data` a required `T`,
 * forcing unsafe casts in every bridge implementation.
 */
export type BridgeResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; data?: unknown };

/**
 * Bridge interface — abstracts the WebSocket transport from the tools.
 */
export interface Bridge {
  send<T = unknown>(request: BridgeRequest): Promise<BridgeResponse<T>>;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
