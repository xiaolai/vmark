// @vitest-environment node
// Routing coverage for dispatchV2 — every vmark.* action must reach its
// handler exactly once, and unrecognized types must fall through (return
// false) so the top-level handleRequest can answer with "Unknown request".
//
// The workspace and browser handler modules wrap Tauri, so they are replaced
// here. The session, document, workflow and selection handlers are the app's
// own logic and run for real: each first reads its payload against ITS
// operation's contract, which reports an undeclared field by naming that
// operation. A probe field therefore identifies the handler a request reached,
// and the one answer it sends leaves through the Tauri `invoke` boundary.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { McpResponse } from "@/services/mcpBridge/types";
import type { McpRequestEvent } from "@/services/mcpBridge/types";
import { withAttribution } from "@/test/mcpAttributionFixture";
import { createMcpWriteContext } from "@/services/mcpBridge/writeContext";
import {
  BROWSER_ROUTED_OPERATIONS,
  ROUTED_OPERATIONS,
  SUPPORTED_TOOL_PREFIXES,
  dispatchV2,
} from "@/services/mcpBridge/v2/dispatch";

/** The write context the last `dispatch` passed, to check handlers receive it. */
let lastContext: ReturnType<typeof createMcpWriteContext> | null = null;

/** Dispatch as the router does: the event plus its write context. */
function dispatch(event: Omit<McpRequestEvent, "attribution">): Promise<boolean> {
  const attributed = withAttribution(event);
  lastContext = createMcpWriteContext(attributed);
  return dispatchV2(attributed, lastContext);
}

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

const PROBE = "routeProbe";
let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  consoleWarn.mockRestore();
});

/** The operations whose contract a real handler read, in order. */
function operationsParsed(): string[] {
  return consoleWarn.mock.calls
    .filter((call) => call[0] === "[MCP Contract]")
    .map((call) => String(call[1]).split(" carried undeclared field(s) ")[0]);
}

/** The answers sent back across the Tauri boundary. */
function responses(): McpResponse[] {
  return vi.mocked(invoke).mock.calls
    .filter(([command]) => command === "mcp_bridge_respond")
    .map(([, payload]) => (payload as { payload: McpResponse }).payload);
}

// Table of (request type, fixture args, and — for a handler module that wraps
// Tauri — its mock). Each row asserts that dispatchV2 returns true and that the
// request reached the handler for ITS type exactly once, args included.
const ROUTES: Array<{
  type: string;
  /** The mocked handler; absent where the real handler runs. */
  handler?: ReturnType<typeof vi.fn>;
  args?: Record<string, unknown>;
}> = [
  { type: "vmark.session.get_state", args: { clientProtocol: "0.3.0" } },
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
  { type: "vmark.document.read", args: {} },
  { type: "vmark.document.write", args: { content: "x" } },
  { type: "vmark.document.transform", args: { kind: "cjk-spacing" } },
  { type: "vmark.workflow.apply_patch", args: { patches: [] } },
  { type: "vmark.workflow.validate", args: {} },
  { type: "vmark.selection.get", args: {} },
  { type: "vmark.selection.set", args: { content: "x" } },
  { type: "vmark.comments.list", args: {} },
  { type: "vmark.comments.reply", args: {} },
  { type: "vmark.comments.mark_addressed", args: {} },
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
      expect(await dispatch({ id: "proto", type, args: {} })).toBe(false);
    },
  );

  it.each(ROUTES)("routes $type to its handler", async (route) => {
    const id = `req-${route.type}`;
    if (route.handler) {
      const args = route.args ?? {};
      expect(await dispatch({ id, type: route.type, args })).toBe(true);
      expect(route.handler).toHaveBeenCalledTimes(1);
      // Eager handlers get the request's write context; browser ones change
      // no document and are called without it.
      if (route.type.startsWith("vmark.browser.")) {
        expect(route.handler).toHaveBeenCalledWith(id, args);
      } else {
        expect(route.handler).toHaveBeenCalledWith(id, args, lastContext);
      }
      return;
    }
    const args = { ...route.args, [PROBE]: true };
    expect(await dispatch({ id, type: route.type, args })).toBe(true);
    // The handler that parsed THIS operation saw these args, once…
    expect(operationsParsed()).toEqual([route.type]);
    // …and answered this request, once.
    expect(responses().map((r) => r.id)).toEqual([id]);
  });

  it("session.get_state carries the app version into the answer", async () => {
    await dispatch({ id: "req-version", type: "vmark.session.get_state", args: {} });
    expect(responses()).toEqual([
      expect.objectContaining({
        id: "req-version",
        success: true,
        data: expect.objectContaining({
          capabilities: expect.objectContaining({ version: __VMARK_VERSION__ }),
        }),
      }),
    ]);
  });

  it("returns false for unrecognized request types", async () => {
    const matched = await dispatch({
      id: "req-unknown",
      type: "vmark.bogus.action",
      args: { [PROBE]: true },
    });
    expect(matched).toBe(false);

    // No handler ran: nothing parsed a payload, answered, or was called.
    expect(operationsParsed()).toEqual([]);
    expect(responses()).toEqual([]);
    for (const route of ROUTES) if (route.handler) expect(route.handler).not.toHaveBeenCalled();
  });

  it("does not forward to other handlers when one matches", async () => {
    await dispatch({
      id: "req-iso",
      type: "vmark.selection.get",
      args: { [PROBE]: true },
    });
    expect(operationsParsed()).toEqual(["vmark.selection.get"]);
    expect(responses().map((r) => r.id)).toEqual(["req-iso"]);
    for (const route of ROUTES) if (route.handler) expect(route.handler).not.toHaveBeenCalled();
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
        "vmark.comments.list",
        "vmark.comments.mark_addressed",
        "vmark.comments.reply",
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
