// Routing coverage for dispatchV2 — every vmark.* action must reach its
// handler exactly once, and unrecognized types must fall through (return
// false) so the top-level handleRequest can answer with "Unknown request".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchV2 } from "../dispatch";

vi.mock("../session", () => ({
  handleSessionGetState: vi.fn(async () => undefined),
}));

vi.mock("../document", () => ({
  handleDocumentRead: vi.fn(async () => undefined),
  handleDocumentWrite: vi.fn(async () => undefined),
  handleDocumentTransform: vi.fn(async () => undefined),
}));

vi.mock("../workspace", () => ({
  handleWorkspaceNew: vi.fn(async () => undefined),
  handleWorkspaceOpen: vi.fn(async () => undefined),
  handleWorkspaceSave: vi.fn(async () => undefined),
  handleWorkspaceSaveAs: vi.fn(async () => undefined),
  handleWorkspaceClose: vi.fn(async () => undefined),
  handleWorkspaceSwitchTab: vi.fn(async () => undefined),
  handleWorkspaceFocusWindow: vi.fn(async () => undefined),
}));

vi.mock("../workflow", () => ({
  handleWorkflowApplyPatch: vi.fn(async () => undefined),
  handleWorkflowValidate: vi.fn(async () => undefined),
}));

vi.mock("../selection", () => ({
  handleSelectionGet: vi.fn(async () => undefined),
  handleSelectionSet: vi.fn(async () => undefined),
}));

import { handleSessionGetState } from "../session";
import {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentTransform,
} from "../document";
import {
  handleWorkspaceNew,
  handleWorkspaceOpen,
  handleWorkspaceSave,
  handleWorkspaceSaveAs,
  handleWorkspaceClose,
  handleWorkspaceSwitchTab,
  handleWorkspaceFocusWindow,
} from "../workspace";
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "../workflow";
import { handleSelectionGet, handleSelectionSet } from "../selection";

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
];

describe("dispatchV2 — routing", () => {
  it.each(ROUTES)("routes $type to its handler", async (route) => {
    const id = `req-${route.type}`;
    const args = route.args ?? {};
    const matched = await dispatchV2({ id, type: route.type, args });

    expect(matched).toBe(true);
    expect(route.handler).toHaveBeenCalledTimes(1);

    if (route.passesArgsObject === false) {
      // session.get_state takes (id, version-string) — both arguments
      // are present, second is a non-empty string, but the dispatcher
      // does not forward `args`.
      expect(route.handler).toHaveBeenCalledWith(id, expect.any(String));
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
        "vmark.workspace.save",
        "vmark.workspace.save_as",
        "vmark.workspace.switch_tab",
      ].sort(),
    );
  });
});
