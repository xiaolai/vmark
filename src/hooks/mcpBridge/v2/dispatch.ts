/**
 * Purpose: Route the pruned 5-tool MCP surface — `vmark.session.*`,
 *   `vmark.workspace.*`, `vmark.document.*`, `vmark.workflow.*`,
 *   `vmark.selection.*` — to their handlers. Returns `true` iff the
 *   request type matched. Also exports SUPPORTED_TOOL_PREFIXES as the
 *   single source of truth for the routed surface — anything that
 *   enumerates supported tools (diagnostic errors, capability docs)
 *   must import this rather than carry its own list.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md WI-1.2 (initial 4 tools)
 *   and WI-2.1 (selection re-add per ADR-7).
 *
 * @coordinates-with hooks/mcpBridge/handleRequest.ts — top-level router; consumes SUPPORTED_TOOL_PREFIXES
 * @module hooks/mcpBridge/v2/dispatch
 */

import type { McpRequestEvent } from "../types";
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
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "./workflow";
import { handleSelectionGet, handleSelectionSet } from "./selection";
import {
  handleBrowserRead,
  handleBrowserAct,
  handleBrowserOpen,
  handleBrowserNavigate,
  handleBrowserWait,
  handleBrowserScreenshot,
  handleBrowserWaitFor,
  handleBrowserQuery,
  handleBrowserStyle,
  handleBrowserExecuteJs,
  handleBrowserSessionSave,
  handleBrowserSessionLoad,
} from "./browser";

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
      await handleSessionGetState(id, APP_VERSION);
      return true;

    case "vmark.workspace.new":
      await handleWorkspaceNew(id, args);
      return true;
    case "vmark.workspace.open":
      await handleWorkspaceOpen(id, args);
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
      await handleBrowserRead(id, args);
      return true;
    case "vmark.browser.act":
      await handleBrowserAct(id, args);
      return true;
    case "vmark.browser.open":
      await handleBrowserOpen(id, args);
      return true;
    case "vmark.browser.navigate":
      await handleBrowserNavigate(id, args);
      return true;
    case "vmark.browser.wait":
      await handleBrowserWait(id, args);
      return true;
    case "vmark.browser.screenshot":
      await handleBrowserScreenshot(id, args);
      return true;
    case "vmark.browser.wait_for":
      await handleBrowserWaitFor(id, args);
      return true;
    case "vmark.browser.query":
      await handleBrowserQuery(id, args);
      return true;
    case "vmark.browser.style":
      await handleBrowserStyle(id, args);
      return true;
    case "vmark.browser.execute_js":
      await handleBrowserExecuteJs(id, args);
      return true;
    case "vmark.browser.session.save":
      await handleBrowserSessionSave(id, args);
      return true;
    case "vmark.browser.session.load":
      await handleBrowserSessionLoad(id, args);
      return true;

    default:
      return false;
  }
}
