/**
 * Purpose: Route the pruned MCP surface — `vmark.session.*`,
 *   `vmark.workspace.*`, `vmark.document.*`, `vmark.workflow.*`,
 *   `vmark.selection.*` and the `vmark.browser.*` tools — to their handlers. Returns `true` iff the
 *   request type matched. Also exports SUPPORTED_TOOL_PREFIXES as the
 *   single source of truth for the routed surface — anything that
 *   enumerates supported tools (diagnostic errors, capability docs)
 *   must import this rather than carry its own list.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md WI-1.2 (initial 4 tools)
 *   and WI-2.1 (selection re-add per ADR-7).
 *
 * Key decisions:
 *   - Routing is two TYPED TABLES, not a switch (round 3, #74): `EAGER_ROUTES`
 *     maps each non-browser operation to its handler, `BROWSER_ROUTES` maps each
 *     browser operation to the NAME of its export in `./browser`. A table entry
 *     is checked by the compiler against the handler signature (or the export
 *     set), where a copied `case` label wired to the wrong handler was not.
 *   - Lookups are own-property only: the type string comes from an untrusted
 *     client, and a plain-object index on `"constructor"` would have returned
 *     `Object` and called it.
 *   - `ROUTED_OPERATIONS` / `BROWSER_ROUTED_OPERATIONS` are exported for the
 *     completeness proofs (`dispatch.test.ts`, `operationManifestParity.test.ts`),
 *     which read the tables instead of scraping case labels.
 *
 * @coordinates-with services/mcpBridge/handleRequest.ts — top-level router; consumes SUPPORTED_TOOL_PREFIXES
 * @coordinates-with services/mcpBridge/v2/operationManifest.ts — the manifest the tables must match
 * @module services/mcpBridge/v2/dispatch
 */

import type { McpRequestEvent } from "@/services/mcpBridge/types";
import { handleSessionGetState } from "./session";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "./document";
import {
  handleWorkspaceNew,
  handleWorkspaceOpen,
  handleWorkspaceSave,
  handleWorkspaceSaveAs,
  handleWorkspaceClose,
  handleWorkspaceSwitchTab,
  handleWorkspaceFocusWindow,
} from "./workspace";
import { handleWorkspaceOpenWorkspace } from "./workspaceOpenFolder";
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "./workflow";
import { handleSelectionGet, handleSelectionSet } from "./selection";

/**
 * App version used in the `session.get_state` capabilities payload.
 * Injected from `package.json` at build time via `__VMARK_VERSION__`
 * (see vite.config.ts).
 */
const APP_VERSION = __VMARK_VERSION__;

/**
 * Tool prefixes this dispatcher routes — single source of truth.
 * Anything that wants to enumerate supported tools (diagnostic error
 * strings, capability discovery, docs) should import this rather than
 * keep its own list, so a new tool addition can never silently leave
 * the diagnostic surface stale (#900).
 */
export const SUPPORTED_TOOL_PREFIXES = [
  "vmark.session.*",
  "vmark.workspace.*",
  "vmark.document.*",
  "vmark.workflow.*",
  "vmark.selection.*",
  "vmark.browser.*",
] as const;

type Handler = (id: string, args: Record<string, unknown>) => Promise<void>;

/** Every operation handled by an eagerly loaded module. */
const EAGER_ROUTES = {
  // session.get_state takes (id, app version, args): the version rides along.
  "vmark.session.get_state": (id, args) => handleSessionGetState(id, APP_VERSION, args),

  "vmark.workspace.new": handleWorkspaceNew,
  "vmark.workspace.open": handleWorkspaceOpen,
  "vmark.workspace.open_workspace": handleWorkspaceOpenWorkspace,
  "vmark.workspace.save": handleWorkspaceSave,
  "vmark.workspace.save_as": handleWorkspaceSaveAs,
  "vmark.workspace.close": handleWorkspaceClose,
  "vmark.workspace.switch_tab": handleWorkspaceSwitchTab,
  "vmark.workspace.focus_window": handleWorkspaceFocusWindow,

  "vmark.document.read": handleDocumentRead,
  "vmark.document.write": handleDocumentWrite,
  "vmark.document.transform": handleDocumentTransform,

  "vmark.workflow.apply_patch": handleWorkflowApplyPatch,
  "vmark.workflow.validate": handleWorkflowValidate,

  "vmark.selection.get": handleSelectionGet,
  "vmark.selection.set": handleSelectionSet,
} as const satisfies Record<string, Handler>;

/**
 * The browser handlers are the largest cluster behind this dispatcher and run
 * only when a `vmark.browser.*` request arrives — never at cold start, since the
 * bridge connects after bootstrap. Loading them on first use keeps the whole
 * cluster out of the eagerly preloaded App chunk (`EAGER: App` in
 * `.size-limit.cjs`); the module system caches the import, so every request
 * after the first pays nothing. Each entry names the export of `./browser` that
 * handles it, so a misspelling is a compile error, not a request that falls
 * through.
 */
type BrowserHandlers = typeof import("./browser");
const BROWSER_ROUTES = {
  "vmark.browser.read": "handleBrowserRead",
  "vmark.browser.act": "handleBrowserAct",
  "vmark.browser.open": "handleBrowserOpen",
  "vmark.browser.navigate": "handleBrowserNavigate",
  "vmark.browser.wait": "handleBrowserWait",
  "vmark.browser.screenshot": "handleBrowserScreenshot",
  "vmark.browser.wait_for": "handleBrowserWaitFor",
  "vmark.browser.query": "handleBrowserQuery",
  "vmark.browser.extract": "handleBrowserExtract",
  "vmark.browser.workflow_run": "handleBrowserWorkflowRun",
  "vmark.browser.workflow_status": "handleBrowserWorkflowStatus",
  "vmark.browser.workflow_cancel": "handleBrowserWorkflowCancel",
  "vmark.browser.workflow_record": "handleBrowserWorkflowRecord",
  "vmark.browser.style": "handleBrowserStyle",
  "vmark.browser.execute_js": "handleBrowserExecuteJs",
  "vmark.browser.session.save": "handleBrowserSessionSave",
  "vmark.browser.session.load": "handleBrowserSessionLoad",
  "vmark.browser.console": "handleBrowserConsole",
  "vmark.browser.close": "handleBrowserClose",
} as const satisfies Record<`vmark.browser.${string}`, keyof BrowserHandlers>;

/** The browser operations this dispatcher routes (lazily). */
export const BROWSER_ROUTED_OPERATIONS: readonly string[] = Object.freeze(Object.keys(BROWSER_ROUTES));

/** Every operation this dispatcher routes — the webview half of the manifest. */
export const ROUTED_OPERATIONS: readonly string[] = Object.freeze([
  ...Object.keys(EAGER_ROUTES),
  ...BROWSER_ROUTED_OPERATIONS,
]);

/** Own-property lookup: the type is client-supplied, so `"constructor"` must miss. */
function ownRoute<T extends object>(table: T, type: string): T[keyof T] | undefined {
  return Object.hasOwn(table, type) ? table[type as keyof T] : undefined;
}

export async function dispatchV2(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  const eager = ownRoute(EAGER_ROUTES, type);
  if (eager) {
    await eager(id, args);
    return true;
  }
  const lazy = ownRoute(BROWSER_ROUTES, type);
  if (lazy) {
    const browser = await import("./browser");
    await browser[lazy](id, args);
    return true;
  }
  return false;
}
