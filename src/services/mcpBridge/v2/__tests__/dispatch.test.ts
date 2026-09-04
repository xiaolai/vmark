// @vitest-environment node
// Routing coverage for dispatchV2 — every vmark.* action must reach its
// handler exactly once, and unrecognized types must fall through (return
// false) so the top-level handleRequest can answer with "Unknown request".

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BROWSER_ROUTED_OPERATIONS,
  ROUTED_OPERATIONS,
  SUPPORTED_TOOL_PREFIXES,
  dispatchV2,
} from "@/services/mcpBridge/v2/dispatch";

vi.mock("@/services/mcpBridge/v2/session", () => ({
  handleSessionGetState: vi.fn(async () => undefined),
}));

vi.mock("@/services/mcpBridge/v2/document", () => ({
  handleDocumentRead: vi.fn(async () => undefined),
  handleDocumentWrite: vi.fn(async () => undefined),
  handleDocumentTransform: vi.fn(async () => undefined),
}));

vi.mock("@/services/mcpBridge/v2/workspace", () => ({
  handleWorkspaceNew: vi.fn(async () => undefined),
  handleWorkspaceOpen: vi.fn(async () => undefined),
  handleWorkspaceSave: vi.fn(async () => undefined),
  handleWorkspaceSaveAs: vi.fn(async () => undefined),
  handleWorkspaceClose: vi.fn(async () => undefined),
  handleWorkspaceSwitchTab: vi.fn(async () => undefined),
  handleWorkspaceFocusWindow: vi.fn(async () => undefined),
}));

vi.mock("@/services/mcpBridge/v2/workspaceOpenFolder", () => ({
  handleWorkspaceOpenWorkspace: vi.fn(async () => undefined),
}));

vi.mock("@/services/mcpBridge/v2/workflow", () => ({
  handleWorkflowApplyPatch: vi.fn(async () => undefined),
  handleWorkflowValidate: vi.fn(async () => undefined),
}));

vi.mock("@/services/mcpBridge/v2/selection", () => ({
  handleSelectionGet: vi.fn(async () => undefined),
  handleSelectionSet: vi.fn(async () => undefined),
}));
vi.mock("@/services/mcpBridge/v2/browser", () => ({
  handleBrowserRead: vi.fn(async () => undefined),
  handleBrowserAct: vi.fn(async () => undefined),
  handleBrowserOpen: vi.fn(async () => undefined),
  handleBrowserNavigate: vi.fn(async () => undefined),
  handleBrowserWait: vi.fn(async () => undefined),
  handleBrowserWaitFor: vi.fn(async () => undefined),
  handleBrowserScreenshot: vi.fn(async () => undefined),
  handleBrowserQuery: vi.fn(async () => undefined),
  handleBrowserExtract: vi.fn(async () => undefined),
  handleBrowserWorkflowRun: vi.fn(async () => undefined),
  handleBrowserWorkflowStatus: vi.fn(async () => undefined),
  handleBrowserWorkflowCancel: vi.fn(async () => undefined),
  handleBrowserWorkflowRecord: vi.fn(async () => undefined),
  handleBrowserStyle: vi.fn(async () => undefined),
  handleBrowserExecuteJs: vi.fn(async () => undefined),
  handleBrowserSessionSave: vi.fn(async () => undefined),
  handleBrowserSessionLoad: vi.fn(async () => undefined),
  handleBrowserConsole: vi.fn(async () => undefined),
  handleBrowserClose: vi.fn(async () => undefined),
}));

import { handleSessionGetState } from "@/services/mcpBridge/v2/session";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "@/services/mcpBridge/v2/document";
import {
  handleWorkspaceNew,
  handleWorkspaceOpen,
  handleWorkspaceSave,
  handleWorkspaceSaveAs,
  handleWorkspaceClose,
  handleWorkspaceSwitchTab,
  handleWorkspaceFocusWindow,
} from "@/services/mcpBridge/v2/workspace";
import { handleWorkspaceOpenWorkspace } from "@/services/mcpBridge/v2/workspaceOpenFolder";
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "@/services/mcpBridge/v2/workflow";
import { handleSelectionGet, handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import {
  handleBrowserRead,
  handleBrowserAct,
  handleBrowserOpen,
  handleBrowserNavigate,
  handleBrowserWait,
  handleBrowserWaitFor,
  handleBrowserScreenshot,
  handleBrowserQuery,
  handleBrowserExtract,
  handleBrowserWorkflowRun,
  handleBrowserWorkflowStatus,
  handleBrowserWorkflowCancel,
  handleBrowserWorkflowRecord,
  handleBrowserStyle,
  handleBrowserExecuteJs,
  handleBrowserSessionSave,
  handleBrowserSessionLoad,
  handleBrowserConsole,
  handleBrowserClose,
} from "@/services/mcpBridge/v2/browser";

beforeEach(() => {
  vi.clearAllMocks();
});

// Table of (request type, handler mock, fixture args). Each row asserts:
//   - dispatchV2 returns true (the type was recognized)
//   - the matching handler was called exactly once
//   - the handler received (id, args)  [session is special: id + APP_VERSION string]
const ROUTES: Array<{
  type: string;
  handler: ReturnType<typeof vi.fn>;
  args?: Record<string, unknown>;
  /** When true, the handler signature is `(id, value)` not `(id, args)` */
  passesArgsObject?: boolean;
}> = [
  {
    type: "vmark.session.get_state",
    handler: handleSessionGetState as unknown as ReturnType<typeof vi.fn>,
    args: { clientProtocol: "0.3.0" },
    passesArgsObject: false,
  },
  {
    type: "vmark.workspace.new",
    handler: handleWorkspaceNew as unknown as ReturnType<typeof vi.fn>,
    args: { kind: "markdown" },
  },
  {
    type: "vmark.workspace.open",
    handler: handleWorkspaceOpen as unknown as ReturnType<typeof vi.fn>,
    args: { filePath: "/x.md" },
  },
  {
    // Routed since the folder-open tool shipped, but absent from this table until
    // round 3 (#74): the old completeness proof covered only vmark.browser.*.
    type: "vmark.workspace.open_workspace",
    handler: handleWorkspaceOpenWorkspace as unknown as ReturnType<typeof vi.fn>,
    args: { folderPath: "/w" },
  },
  {
    type: "vmark.workspace.save",
    handler: handleWorkspaceSave as unknown as ReturnType<typeof vi.fn>,
    args: {},
  },
  {
    type: "vmark.workspace.save_as",
    handler: handleWorkspaceSaveAs as unknown as ReturnType<typeof vi.fn>,
    args: { filePath: "/y.md" },
  },
  {
    type: "vmark.workspace.close",
    handler: handleWorkspaceClose as unknown as ReturnType<typeof vi.fn>,
    args: { tabId: "t" },
  },
  {
    type: "vmark.workspace.switch_tab",
    handler: handleWorkspaceSwitchTab as unknown as ReturnType<typeof vi.fn>,
    args: { tabId: "t" },
  },
  {
    type: "vmark.workspace.focus_window",
    handler: handleWorkspaceFocusWindow as unknown as ReturnType<typeof vi.fn>,
    args: { windowLabel: "main" },
  },
  {
    type: "vmark.document.read",
    handler: handleDocumentRead as unknown as ReturnType<typeof vi.fn>,
    args: {},
  },
  {
    type: "vmark.document.write",
    handler: handleDocumentWrite as unknown as ReturnType<typeof vi.fn>,
    args: { content: "x" },
  },
  {
    type: "vmark.document.transform",
    handler: handleDocumentTransform as unknown as ReturnType<typeof vi.fn>,
    args: { kind: "cjk-spacing" },
  },
  {
    type: "vmark.workflow.apply_patch",
    handler: handleWorkflowApplyPatch as unknown as ReturnType<typeof vi.fn>,
    args: { patches: [] },
  },
  {
    type: "vmark.workflow.validate",
    handler: handleWorkflowValidate as unknown as ReturnType<typeof vi.fn>,
    args: {},
  },
  {
    type: "vmark.selection.get",
    handler: handleSelectionGet as unknown as ReturnType<typeof vi.fn>,
    args: {},
  },
  {
    type: "vmark.selection.set",
    handler: handleSelectionSet as unknown as ReturnType<typeof vi.fn>,
    args: { content: "x" },
  },
  {
    type: "vmark.browser.read",
    handler: handleBrowserRead as unknown as ReturnType<typeof vi.fn>,
    args: {},
  },
  {
    type: "vmark.browser.act",
    handler: handleBrowserAct as unknown as ReturnType<typeof vi.fn>,
    args: { operation: "click", role: "button", name: "Go" },
  },
  { type: "vmark.browser.open", handler: handleBrowserOpen as unknown as ReturnType<typeof vi.fn>, args: { url: "https://example.com" } },
  { type: "vmark.browser.navigate", handler: handleBrowserNavigate as unknown as ReturnType<typeof vi.fn>, args: { url: "https://example.com" } },
  { type: "vmark.browser.wait", handler: handleBrowserWait as unknown as ReturnType<typeof vi.fn>, args: {} },
  { type: "vmark.browser.wait_for", handler: handleBrowserWaitFor as unknown as ReturnType<typeof vi.fn>, args: { text: "Done" } },
  { type: "vmark.browser.screenshot", handler: handleBrowserScreenshot as unknown as ReturnType<typeof vi.fn>, args: {} },
  { type: "vmark.browser.query", handler: handleBrowserQuery as unknown as ReturnType<typeof vi.fn>, args: { selector: "#a" } },
  { type: "vmark.browser.extract", handler: handleBrowserExtract as unknown as ReturnType<typeof vi.fn>, args: {} },
  { type: "vmark.browser.workflow_run", handler: handleBrowserWorkflowRun as unknown as ReturnType<typeof vi.fn>, args: { source: "1. click OK" } },
  { type: "vmark.browser.workflow_status", handler: handleBrowserWorkflowStatus as unknown as ReturnType<typeof vi.fn>, args: { runId: "r1" } },
  { type: "vmark.browser.workflow_cancel", handler: handleBrowserWorkflowCancel as unknown as ReturnType<typeof vi.fn>, args: { runId: "r1" } },
  { type: "vmark.browser.workflow_record", handler: handleBrowserWorkflowRecord as unknown as ReturnType<typeof vi.fn>, args: { recordOp: "start" } },
  { type: "vmark.browser.style", handler: handleBrowserStyle as unknown as ReturnType<typeof vi.fn>, args: { injectCss: "b{}" } },
  { type: "vmark.browser.execute_js", handler: handleBrowserExecuteJs as unknown as ReturnType<typeof vi.fn>, args: { script: "return 1" } },
  { type: "vmark.browser.session.save", handler: handleBrowserSessionSave as unknown as ReturnType<typeof vi.fn>, args: { handle: "h" } },
  { type: "vmark.browser.session.load", handler: handleBrowserSessionLoad as unknown as ReturnType<typeof vi.fn>, args: { handle: "h" } },
  { type: "vmark.browser.console", handler: handleBrowserConsole as unknown as ReturnType<typeof vi.fn>, args: {} },
  { type: "vmark.browser.close", handler: handleBrowserClose as unknown as ReturnType<typeof vi.fn>, args: { tabId: "t" } },
];

describe("dispatchV2 — routing", () => {
  it("covers every vmark.browser.* route the dispatcher declares (a route wired to the wrong handler is invisible to manifest parity)", () => {
    // Read from the exported route table (round 3, #74), not scraped from case labels.
    const tabled = ROUTES.map((r) => r.type).filter((t) => t.startsWith("vmark.browser.")).sort();
    expect(tabled).toEqual([...BROWSER_ROUTED_OPERATIONS].sort());
  });

  it("covers every route the dispatcher declares, browser or not", () => {
    expect(ROUTES.map((r) => r.type).sort()).toEqual([...ROUTED_OPERATIONS].sort());
  });

  it("every routed operation falls under one advertised prefix, and every prefix routes something", () => {
    const prefixes = SUPPORTED_TOOL_PREFIXES.map((p) => p.slice(0, -1));
    for (const type of ROUTED_OPERATIONS) {
      expect(prefixes.some((p) => type.startsWith(p)), type).toBe(true);
    }
    for (const prefix of prefixes) {
      expect(ROUTED_OPERATIONS.some((t) => t.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "does not route the prototype key %j the untrusted client could send",
    async (type) => {
      expect(await dispatchV2({ id: "proto", type, args: {} })).toBe(false);
    },
  );

  it.each(ROUTES)("routes $type to its handler", async (route) => {
    const id = `req-${route.type}`;
    const args = route.args ?? {};
    const matched = await dispatchV2({ id, type: route.type, args });

    expect(matched).toBe(true);
    expect(route.handler).toHaveBeenCalledTimes(1);

    if (route.passesArgsObject === false) {
      // session.get_state takes (id, version-string, args) — the app version
      // plus the request args, which carry the client's declared protocol.
      expect(route.handler).toHaveBeenCalledWith(id, expect.any(String), args);
    } else {
      expect(route.handler).toHaveBeenCalledWith(id, args);
    }
  });

  it("returns false for unrecognized request types", async () => {
    const matched = await dispatchV2({
      id: "req-unknown",
      type: "vmark.bogus.action",
      args: {},
    });
    expect(matched).toBe(false);

    // No handler should have been invoked.
    expect(handleSessionGetState).not.toHaveBeenCalled();
    expect(handleDocumentRead).not.toHaveBeenCalled();
    expect(handleSelectionGet).not.toHaveBeenCalled();
  });

  it("does not forward to other handlers when one matches", async () => {
    await dispatchV2({
      id: "req-iso",
      type: "vmark.selection.get",
      args: {},
    });
    expect(handleSelectionGet).toHaveBeenCalledTimes(1);
    expect(handleSelectionSet).not.toHaveBeenCalled();
    expect(handleDocumentRead).not.toHaveBeenCalled();
    expect(handleSessionGetState).not.toHaveBeenCalled();
  });

  it("the routed handler list is exactly the supported tool surface", () => {
    // Lock the route table: changing the surface requires updating
    // both the dispatcher and this test, which forces a deliberate
    // edit rather than silent drift.
    const types = ROUTES.map((r) => r.type).sort();
    expect(types).toEqual(
      [
        "vmark.browser.act",
        "vmark.browser.close",
        "vmark.browser.console",
        "vmark.browser.execute_js",
        "vmark.browser.extract",
        "vmark.browser.navigate",
        "vmark.browser.open",
        "vmark.browser.query",
        "vmark.browser.read",
        "vmark.browser.screenshot",
        "vmark.browser.session.load",
        "vmark.browser.session.save",
        "vmark.browser.style",
        "vmark.browser.wait",
        "vmark.browser.wait_for",
        "vmark.browser.workflow_cancel",
        "vmark.browser.workflow_record",
        "vmark.browser.workflow_run",
        "vmark.browser.workflow_status",
        "vmark.document.read",
        "vmark.document.transform",
        "vmark.document.write",
        "vmark.selection.get",
        "vmark.selection.set",
        "vmark.session.get_state",
        "vmark.workflow.apply_patch",
        "vmark.workflow.validate",
        "vmark.workspace.close",
        "vmark.workspace.focus_window",
        "vmark.workspace.new",
        "vmark.workspace.open",
        "vmark.workspace.open_workspace",
        "vmark.workspace.save",
        "vmark.workspace.save_as",
        "vmark.workspace.switch_tab",
      ].sort(),
    );
  });
});
