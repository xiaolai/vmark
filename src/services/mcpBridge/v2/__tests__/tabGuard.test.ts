// WI-RA1A.6 — one tab/revision guard for the bridge handlers.
//
// "Resolve the tab or refuse INVALID_TAB, check the revision or refuse STALE"
// was written out per handler and had drifted: some replies said why a tab did
// not resolve, others said the same sentence for every cause. The first half
// of this file pins the guard itself; the second runs every handler that uses
// it through the same refusals and requires the same reply from each.
//
// Real stores throughout. Only the reply channel is captured, at the Tauri
// boundary (`mcp_bridge_respond`).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import type { McpResponse } from "@/services/mcpBridge/types";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import {
  requireCurrentRevision,
  requireTab,
  resolveKind,
  resolveTab,
} from "@/services/mcpBridge/v2/tabGuard";
import {
  handleDocumentRead,
  handleDocumentTransform,
  handleDocumentWrite,
} from "@/services/mcpBridge/v2/document";
import { handleSelectionGet, handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";

/** Every reply sent through the bridge, read at the Tauri boundary. */
function replies(): McpResponse[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: McpResponse }).payload);
}

function replyTo(id: string): McpResponse {
  const found = replies().filter((r) => r.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

function errorOf(id: string): { error: string; message: string; current_revision?: string } {
  const reply = replyTo(id);
  expect(reply.success).toBe(false);
  return JSON.parse(reply.error ?? "null");
}

/** Open `tabs` in `windowLabel`; the first is that window's active tab. */
function openTabs(
  windowLabel: string,
  tabs: Array<{ id: string; content?: string; filePath?: string | null }>,
): void {
  useTabStore.setState((state) => ({
    tabs: {
      ...state.tabs,
      [windowLabel]: tabs.map((t) => ({
        kind: "document" as const,
        id: t.id,
        filePath: t.filePath ?? null,
        title: t.id,
        isPinned: false,
        formatId: "markdown",
      })),
    },
    activeTabId: { ...state.activeTabId, [windowLabel]: tabs[0].id },
  }));
  for (const t of tabs) {
    useDocumentStore.getState().initDocument(t.id, t.content ?? "", t.filePath ?? null);
  }
}

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  useTabStore.setState({ tabs: {}, activeTabId: {} });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  useUIStore.setState({ sourceMode: false });
  // `/w` is the open workspace, so a save_as target under it passes the path
  // guard and the request reaches tab resolution.
  useWorkspaceStore.setState({ rootPath: "/w", isWorkspaceMode: true });
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setActiveSourceView(null);
});

describe("resolveTab", () => {
  it("resolves the focused window's active tab when no tabId is given", () => {
    openTabs("main", [{ id: "t-active", content: "# hi\n", filePath: "/w/a.md" }, { id: "t-other" }]);

    expect(resolveTab(undefined)).toEqual({
      tabId: "t-active",
      windowLabel: "main",
      filePath: "/w/a.md",
      content: "# hi\n",
      dirty: false,
      revision: useRevisionStore.getState().getRevision("t-active"),
      kind: "markdown",
    });
  });

  it("resolves an explicit tabId in ANOTHER window", () => {
    openTabs("main", [{ id: "t-main" }]);
    openTabs("doc-1", [{ id: "t-elsewhere", content: "there\n" }]);

    expect(resolveTab("t-elsewhere")).toMatchObject({ tabId: "t-elsewhere", windowLabel: "doc-1", content: "there\n" });
  });

  it("reports the document's dirty flag as it is now", () => {
    openTabs("main", [{ id: "t-1", content: "saved\n" }]);
    useDocumentStore.getState().setEditorContent("t-1", "edited\n");

    expect(resolveTab("t-1")).toMatchObject({ content: "edited\n", dirty: true });
  });

  it("treats an empty tabId as absent", () => {
    openTabs("main", [{ id: "t-active" }]);

    expect(resolveTab("")).toMatchObject({ tabId: "t-active" });
  });

  it.each([
    { name: "an unknown tabId", arg: "ghost", seed: true, message: "Unknown tabId" },
    { name: "no tabId and no focused tab", arg: undefined, seed: false, message: "No focused tab" },
  ])("refuses $name", ({ arg, seed, message }) => {
    if (seed) openTabs("main", [{ id: "t-1" }]);

    expect(resolveTab(arg)).toEqual({ error: "INVALID_TAB", message });
  });

  it("refuses a tab that has no document behind it", () => {
    openTabs("main", [{ id: "t-orphan" }]);
    useDocumentStore.setState({ documents: {} });

    expect(resolveTab("t-orphan")).toEqual({ error: "INVALID_TAB", message: "No document for tab" });
  });

  it("flushes mounted editors before reading, so the content is current", () => {
    openTabs("main", [{ id: "t-1", content: "stale\n" }]);
    registerWysiwygFlusher("t-1", () => {
      useDocumentStore.getState().setEditorContent("t-1", "what the editor holds\n");
    });

    const resolved = resolveTab("t-1");

    registerWysiwygFlusher("t-1", null);
    expect(resolved).toMatchObject({ content: "what the editor holds\n", dirty: true });
  });

  describe("scope: focused", () => {
    it("resolves the focused tab, with or without its own id", () => {
      openTabs("main", [{ id: "t-focused" }, { id: "t-background" }]);

      expect(resolveTab(undefined, "focused")).toMatchObject({ tabId: "t-focused" });
      expect(resolveTab("t-focused", "focused")).toMatchObject({ tabId: "t-focused" });
      expect(resolveTab("", "focused")).toMatchObject({ tabId: "t-focused", windowLabel: "main" });
    });

    it("refuses another open tab instead of redirecting to the focused one", () => {
      openTabs("main", [{ id: "t-focused" }, { id: "t-background" }]);

      const refused = resolveTab("t-background", "focused");

      expect(refused).toMatchObject({ error: "INVALID_TAB" });
      expect((refused as { message: string }).message).toContain("not the focused tab");
    });

    it("refuses when nothing is focused", () => {
      expect(resolveTab(undefined, "focused")).toEqual({
        error: "INVALID_TAB",
        message: "No focused tab",
      });
    });
  });
});

describe("resolveKind", () => {
  it.each([
    { filePath: "/r/.github/workflows/ci.yml", content: "", kind: "yaml-workflow" },
    { filePath: null, content: "name: ci\non: push\njobs:\n  b:\n    runs-on: x\n    steps:\n      - run: a\n", kind: "yaml-workflow" },
    { filePath: "/r/notes.md", content: "# notes\n", kind: "markdown" },
    { filePath: null, content: "", kind: "markdown" },
  ])("$filePath → $kind", ({ filePath, content, kind }) => {
    expect(resolveKind(filePath, content)).toBe(kind);
  });
});

describe("requireTab / requireCurrentRevision", () => {
  it("requireTab answers INVALID_TAB itself and returns null", async () => {
    expect(await requireTab("req-1", "ghost")).toBeNull();
    expect(errorOf("req-1")).toEqual({ error: "INVALID_TAB", message: "Unknown tabId" });
  });

  it("requireTab returns the tab and sends nothing when it resolves", async () => {
    openTabs("main", [{ id: "t-1" }]);

    expect(await requireTab("req-2", "t-1")).toMatchObject({ tabId: "t-1" });
    expect(replies()).toEqual([]);
  });

  it("an absent revision is allowed", async () => {
    openTabs("main", [{ id: "t-1" }]);

    expect(await requireCurrentRevision("req-3", "t-1", undefined)).toBe(true);
    expect(replies()).toEqual([]);
  });

  it("the current revision is allowed", async () => {
    openTabs("main", [{ id: "t-1" }]);
    const current = useRevisionStore.getState().getRevision("t-1");

    expect(await requireCurrentRevision("req-4", "t-1", current)).toBe(true);
    expect(replies()).toEqual([]);
  });

  it("any other revision is answered STALE with the current one", async () => {
    openTabs("main", [{ id: "t-1" }]);
    const current = useRevisionStore.getState().getRevision("t-1");

    expect(await requireCurrentRevision("req-5", "t-1", "rev-OLDOLDOL")).toBe(false);
    expect(errorOf("req-5")).toEqual({
      error: "STALE",
      message: "Document has changed since the last read",
      current_revision: current,
    });
  });

  it("an empty-string revision is a revision, and it is stale", async () => {
    openTabs("main", [{ id: "t-1" }]);

    expect(await requireCurrentRevision("req-6", "t-1", "")).toBe(false);
    expect(errorOf("req-6").error).toBe("STALE");
  });
});

/** A routed handler, called as dispatchV2 calls it: with the request's write context. */
type Handler = (id: string, args: Record<string, unknown>, context: McpWriteContext) => Promise<void>;

/** Every handler that targets a tab, with the other arguments it needs. */
const TAB_HANDLERS: Array<{ name: string; run: Handler; args: Record<string, unknown> }> = [
  { name: "document.read", run: handleDocumentRead, args: {} },
  { name: "document.write", run: handleDocumentWrite, args: { content: "x", save: false } },
  { name: "document.transform", run: handleDocumentTransform, args: { kind: "cjk-spacing" } },
  { name: "workspace.save", run: handleWorkspaceSave, args: {} },
  { name: "workspace.save_as", run: handleWorkspaceSaveAs, args: { filePath: "/w/out.md" } },
];

const REVISION_HANDLERS: Array<{ name: string; run: Handler; args: Record<string, unknown> }> = [
  { name: "document.write", run: handleDocumentWrite, args: { content: "x", save: false } },
  { name: "document.transform", run: handleDocumentTransform, args: { kind: "cjk-spacing" } },
];

describe.each(TAB_HANDLERS)("$name refuses an unresolvable tab the same way", ({ run, args }) => {
  it("an unknown tabId", async () => {
    openTabs("main", [{ id: "t-1", filePath: "/w/a.md" }]);

    await run("req-unknown", { ...args, tabId: "ghost" }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-unknown")).toEqual({ error: "INVALID_TAB", message: "Unknown tabId" });
  });

  it("no tabId and nothing focused", async () => {
    openTabs("doc-1", [{ id: "t-elsewhere", filePath: "/w/a.md" }]);

    await run("req-none", args, TEST_WRITE_CONTEXT);

    expect(errorOf("req-none")).toEqual({ error: "INVALID_TAB", message: "No focused tab" });
  });

  it("a tab with no document", async () => {
    openTabs("main", [{ id: "t-orphan", filePath: "/w/a.md" }]);
    useDocumentStore.setState({ documents: {} });

    await run("req-orphan", { ...args, tabId: "t-orphan" }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-orphan")).toEqual({ error: "INVALID_TAB", message: "No document for tab" });
  });
});

describe.each(REVISION_HANDLERS)("$name refuses a stale revision the same way", ({ run, args }) => {
  it("answers STALE with the current revision and changes nothing", async () => {
    openTabs("main", [{ id: "t-1", content: "测试ABC\n" }]);
    const current = useRevisionStore.getState().getRevision("t-1");

    await run("req-stale", { ...args, tabId: "t-1", expected_revision: "rev-OLDOLDOL" }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-stale")).toEqual({
      error: "STALE",
      message: "Document has changed since the last read",
      current_revision: current,
    });
    expect(useDocumentStore.getState().documents["t-1"].content).toBe("测试ABC\n");
    expect(useRevisionStore.getState().getRevision("t-1")).toBe(current);
  });
});

describe.each([
  { name: "selection.get", run: handleSelectionGet, args: {} },
  { name: "selection.set", run: handleSelectionSet, args: { content: "x" } },
])("$name acts on the focused tab only", ({ run, args }) => {
  it("refuses another open tab instead of acting on the focused one", async () => {
    openTabs("main", [{ id: "t-focused" }, { id: "t-background" }]);

    await run("req-bg", { ...args, tabId: "t-background" }, TEST_WRITE_CONTEXT);

    const err = errorOf("req-bg");
    expect(err.error).toBe("INVALID_TAB");
    expect(err.message).toContain("not the focused tab");
  });

  it("refuses when nothing is focused", async () => {
    await run("req-none", args, TEST_WRITE_CONTEXT);

    expect(errorOf("req-none")).toEqual({ error: "INVALID_TAB", message: "No focused tab" });
  });
});
