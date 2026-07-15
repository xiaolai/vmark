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
      // `act` targets EITHER a precise `ref` OR an ARIA `role`+`name` (click/type),
      // and for scroll/key carries `dy`/`key`/`modifiers` — so every target field
      // is optional at the type level; the handler validates the combination.
      type: 'vmark.browser.act';
      tabId?: string;
      operation: string;
      role?: string;
      name?: string;
      text?: string;
      ref?: string;
      dy?: number;
      key?: string;
      modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
    }
  | { type: 'vmark.browser.open'; url: string; timeoutMs?: number; profile?: string }
  | { type: 'vmark.browser.navigate'; tabId?: string; url: string; timeoutMs?: number }
  | {
      type: 'vmark.browser.wait';
      tabId?: string;
      navigationId?: string;
      timeoutMs?: number;
    }
  | {
      type: 'vmark.browser.wait_for';
      tabId?: string;
      ref?: string;
      role?: string;
      name?: string;
      text?: string;
      timeoutMs?: number;
    }
  | { type: 'vmark.browser.screenshot'; tabId?: string }
  | { type: 'vmark.browser.query'; tabId?: string; selector: string; fields?: unknown }
  | {
      type: 'vmark.browser.style';
      tabId?: string;
      ref?: string;
      selector?: string;
      set?: Record<string, string>;
      addClasses?: string[];
      removeClasses?: string[];
      injectCss?: string;
    }
  | { type: 'vmark.browser.execute_js'; tabId?: string; script: string }
  | { type: 'vmark.browser.session.save'; tabId?: string; handle: string }
  | { type: 'vmark.browser.session.load'; tabId?: string; handle: string }
  | { type: 'vmark.browser.console'; tabId?: string; clear?: boolean };

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
