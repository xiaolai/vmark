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
 * @coordinates-with services/mcpBridge/handleRequest.ts — top-level router; consumes SUPPORTED_TOOL_PREFIXES
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
 * The browser handlers are the largest cluster behind this switch and run only
 * when a `vmark.browser.*` request arrives — never at cold start, since the
 * bridge connects after bootstrap. Loading them on first use keeps the whole
 * cluster out of the eagerly preloaded App chunk (`EAGER: App` in
 * `.size-limit.cjs`); the module system caches the import, so every request
 * after the first pays nothing. The `case` labels stay HERE so
 * `operationManifestParity.test.ts`, which reads this file's cases against the
 * operation manifest, keeps seeing the whole routed surface.
 */
type BrowserHandlers = typeof import("./browser");
async function viaBrowser(run: (m: BrowserHandlers) => Promise<void>): Promise<true> {
  await run(await import("./browser"));
  return true;
}

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

export async function dispatchV2(event: McpRequestEvent): Promise<boolean> {
  const { id, type, args } = event;
  switch (type) {
    case "vmark.session.get_state":
      await handleSessionGetState(id, APP_VERSION, args);
      return true;

    case "vmark.workspace.new":
      await handleWorkspaceNew(id, args);
      return true;
    case "vmark.workspace.open":
      await handleWorkspaceOpen(id, args);
      return true;
    case "vmark.workspace.open_workspace":
      await handleWorkspaceOpenWorkspace(id, args);
      return true;
    case "vmark.workspace.save":
      await handleWorkspaceSave(id, args);
      return true;
    case "vmark.workspace.save_as":
      await handleWorkspaceSaveAs(id, args);
      return true;
    case "vmark.workspace.close":
      await handleWorkspaceClose(id, args);
      return true;
    case "vmark.workspace.switch_tab":
      await handleWorkspaceSwitchTab(id, args);
      return true;
    case "vmark.workspace.focus_window":
      await handleWorkspaceFocusWindow(id, args);
      return true;

    case "vmark.document.read":
      await handleDocumentRead(id, args);
      return true;
    case "vmark.document.write":
      await handleDocumentWrite(id, args);
      return true;
    case "vmark.document.transform":
      await handleDocumentTransform(id, args);
      return true;

    case "vmark.workflow.apply_patch":
      await handleWorkflowApplyPatch(id, args);
      return true;
    case "vmark.workflow.validate":
      await handleWorkflowValidate(id, args);
      return true;

    case "vmark.selection.get":
      await handleSelectionGet(id, args);
      return true;
    case "vmark.selection.set":
      await handleSelectionSet(id, args);
      return true;

    case "vmark.browser.read":
      return viaBrowser((m) => m.handleBrowserRead(id, args));
    case "vmark.browser.act":
      return viaBrowser((m) => m.handleBrowserAct(id, args));
    case "vmark.browser.open":
      return viaBrowser((m) => m.handleBrowserOpen(id, args));
    case "vmark.browser.navigate":
      return viaBrowser((m) => m.handleBrowserNavigate(id, args));
    case "vmark.browser.wait":
      return viaBrowser((m) => m.handleBrowserWait(id, args));
    case "vmark.browser.screenshot":
      return viaBrowser((m) => m.handleBrowserScreenshot(id, args));
    case "vmark.browser.wait_for":
      return viaBrowser((m) => m.handleBrowserWaitFor(id, args));
    case "vmark.browser.query":
      return viaBrowser((m) => m.handleBrowserQuery(id, args));
    case "vmark.browser.extract":
      return viaBrowser((m) => m.handleBrowserExtract(id, args));
    case "vmark.browser.workflow_run":
      return viaBrowser((m) => m.handleBrowserWorkflowRun(id, args));
    case "vmark.browser.workflow_status":
      return viaBrowser((m) => m.handleBrowserWorkflowStatus(id, args));
    case "vmark.browser.workflow_cancel":
      return viaBrowser((m) => m.handleBrowserWorkflowCancel(id, args));
    case "vmark.browser.workflow_record":
      return viaBrowser((m) => m.handleBrowserWorkflowRecord(id, args));
    case "vmark.browser.style":
      return viaBrowser((m) => m.handleBrowserStyle(id, args));
    case "vmark.browser.execute_js":
      return viaBrowser((m) => m.handleBrowserExecuteJs(id, args));
    case "vmark.browser.session.save":
      return viaBrowser((m) => m.handleBrowserSessionSave(id, args));
    case "vmark.browser.session.load":
      return viaBrowser((m) => m.handleBrowserSessionLoad(id, args));
    case "vmark.browser.console":
      return viaBrowser((m) => m.handleBrowserConsole(id, args));
    case "vmark.browser.close":
      return viaBrowser((m) => m.handleBrowserClose(id, args));

    default:
      return false;
  }
}
