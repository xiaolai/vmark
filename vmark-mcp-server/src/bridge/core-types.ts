/**
 * Core bridge types for communication between the MCP server and VMark.
 *
 * The pruned tool surface (5 core + browser) defines BridgeRequest as a union of the
 * `vmark.*` action types. The Rust bridge parser extracts `type` as the
 * request_type and forwards every other key as args, so all extra
 * fields here are flat (not nested under `args`).
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md
 */

/**
 * Window labels are still string identifiers; kept here so callers can
 * import the type without dragging in the deleted legacy bundles.
 */
export type WindowId = string;

/**
 * Bridge request types — every command the MCP server can send.
 *
 * One entry per (tool, action) pair. See the workflow tool for the
 * IRPatch shape rules; `patches` is `unknown[]` because the
 * discriminated union for IRPatch lives in the frontend repo
 * (`src/lib/ghaWorkflow/save/mutators.ts`) and we don't want to
 * duplicate the shape here.
 */
export type BridgeRequest =
  | { type: 'vmark.session.get_state' }
  | { type: 'vmark.workspace.new'; kind?: string; windowLabel?: string }
  | { type: 'vmark.workspace.open'; filePath: string; windowLabel?: string }
  | { type: 'vmark.workspace.save'; tabId?: string }
  | { type: 'vmark.workspace.save_as'; tabId?: string; filePath: string }
  | { type: 'vmark.workspace.close'; tabId: string; force?: boolean }
  | { type: 'vmark.workspace.switch_tab'; tabId: string }
  | { type: 'vmark.workspace.focus_window'; windowLabel: string }
  | { type: 'vmark.document.read'; tabId?: string }
  | {
      type: 'vmark.document.write';
      tabId?: string;
      content: string;
      expected_revision?: string;
      save?: boolean;
    }
  | {
      type: 'vmark.document.transform';
      tabId?: string;
      kind: string;
      expected_revision?: string;
    }
  | {
      type: 'vmark.workflow.apply_patch';
      tabId?: string;
      patches: unknown[];
      expected_revision?: string;
    }
  | { type: 'vmark.workflow.validate'; tabId?: string }
  | { type: 'vmark.selection.get'; tabId?: string }
  | {
      type: 'vmark.selection.set';
      tabId?: string;
      content: string;
      expected_revision?: string;
    }
  | { type: 'vmark.browser.read'; tabId?: string }
  | {
      type: 'vmark.browser.act';
      tabId?: string;
      operation: string;
      role: string;
      name: string;
      text?: string;
    };

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
}

/** Is `data` the browser approval envelope? */
export function isNeedsApproval(data: unknown): data is NeedsApproval {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { needsApproval?: unknown }).needsApproval === true
  );
}

export type BridgeResponse =
  | { success: true; data: unknown }
  | { success: false; error: string; code?: string; data?: unknown };

/**
 * Bridge interface — abstracts the WebSocket transport from the tools.
 */
export interface Bridge {
  send<T = unknown>(
    request: BridgeRequest,
  ): Promise<BridgeResponse & { data: T }>;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
