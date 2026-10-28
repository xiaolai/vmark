// WI-RA1C.2 — the workflow, workspace and session handlers on the shared guard.
//
// They resolved tabs, checked revisions and read payloads by hand, and their
// copies had missed what the guard does first: bring the mounted editors'
// pending keystrokes into the store. A handler that skips it decides on text
// the user has already moved past — `close` saw a clean tab and dropped typing,
// `open` reloaded over it, `get_state` reported it clean, and a workflow patch
// was applied to the older text.
//
// Real stores throughout. Only the Tauri boundary is mocked (the shared test
// setup): replies are read off `mcp_bridge_respond`, the linter off `gha_lint`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileBytes } from "@/test/fileBytes";

// A document is read as BYTES (services/files/readDocumentText.ts); `fileText`
// is the text the mocked file holds, served through plugin-fs `readFile`.
const { fileText } = vi.hoisted(() => ({
  fileText: vi.fn<(path: string) => Promise<string>>(async () => ""),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (path: string) => fileBytes(fileText(path)),
}));
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { startTabStateCleanup } from "@/services/windowClose/tabCleanup";
import type { McpResponse } from "@/services/mcpBridge/types";
import type { SessionState } from "@/services/mcpBridge/v2/types";
import { handleSessionGetState } from "@/services/mcpBridge/v2/session";
import {
  handleWorkflowApplyPatch,
  handleWorkflowValidate,
} from "@/services/mcpBridge/v2/workflow";
import { handleWorkspaceClose, handleWorkspaceOpen } from "@/services/mcpBridge/v2/workspace";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const MAIN = "main";
const WORKFLOW_PATH = "/w/.github/workflows/ci.yml";
const WORKFLOW = `name: ci
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
/** The workflow after the user typed a new name that has not been flushed. */
const WORKFLOW_TYPED = WORKFLOW.replace("name: ci", "name: 用户改的名字");

function replyTo(id: string): McpResponse {
  const found = vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: McpResponse }).payload)
    .filter((reply) => reply.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

function errorOf(id: string): { error: string; message: string; current_revision?: string } {
  const reply = replyTo(id);
  expect(reply.success).toBe(false);
  return JSON.parse(reply.error ?? "null");
}

function openTab(filePath: string | null, content: string): string {
  const tabId = useTabStore.getState().createTab(MAIN, filePath);
  useDocumentStore.getState().initDocument(tabId, content, filePath);
  return tabId;
}

const contentOf = (tabId: string) => useDocumentStore.getState().documents[tabId]?.content;

const flusherKeys: string[] = [];

/**
 * Stand in for a mounted editor that holds `typed` and has not flushed it yet:
 * the store still has the older text until something asks the editor to flush.
 */
function editorHoldsUnflushed(tabId: string, typed: string): void {
  flusherKeys.push(tabId);
  registerWysiwygFlusher(tabId, () => {
    useDocumentStore.getState().setEditorContent(tabId, typed);
  });
}

let stopCleanup: () => void;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  // The linter answers "no findings"; every other command resolves empty.
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "gha_lint" ? { kind: "ok", diagnostics: [] } : undefined,
  );
  fileText.mockReset();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  useWorkspaceStore.setState({ rootPath: "/w", isWorkspaceMode: true });
  stopCleanup = startTabStateCleanup();
});

afterEach(() => {
  stopCleanup();
  for (const key of flusherKeys.splice(0)) registerWysiwygFlusher(key, null);
});

describe.each([
  {
    name: "workflow.apply_patch",
    run: handleWorkflowApplyPatch,
    args: { patches: [{ kind: "workflow.set", path: "name", value: "renamed" }] },
  },
  { name: "workflow.validate", run: handleWorkflowValidate, args: {} },
])("$name refuses an unresolvable tab as every other handler does", ({ run, args }) => {
  it("an unknown tabId", async () => {
    openTab(WORKFLOW_PATH, WORKFLOW);

    await run("req-unknown", { ...args, tabId: "ghost" }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-unknown")).toEqual({ error: "INVALID_TAB", message: "Unknown tabId" });
  });

  it("no tabId and nothing focused", async () => {
    await run("req-none", args, TEST_WRITE_CONTEXT);

    expect(errorOf("req-none")).toEqual({ error: "INVALID_TAB", message: "No focused tab" });
  });

  it("a tab with no document", async () => {
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    useDocumentStore.setState({ documents: {} });

    await run("req-orphan", { ...args, tabId }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-orphan")).toEqual({ error: "INVALID_TAB", message: "No document for tab" });
  });

  it("an empty tabId means the focused tab", async () => {
    openTab(WORKFLOW_PATH, WORKFLOW);

    await run("req-empty", { ...args, tabId: "" }, TEST_WRITE_CONTEXT);

    expect(replyTo("req-empty").success).toBe(true);
  });

  it("a Markdown tab", async () => {
    const tabId = openTab("/w/notes.md", "# notes\n");

    await run("req-md", { ...args, tabId }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-md").error).toBe("NOT_WORKFLOW");
  });
});

describe("workflow.apply_patch", () => {
  it("refuses a stale revision with the current one and changes nothing", async () => {
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    const current = useRevisionStore.getState().getRevision(tabId);

    await handleWorkflowApplyPatch("req-stale", {
      tabId,
      expected_revision: "rev-OLDOLDOL",
      patches: [{ kind: "workflow.set", path: "name", value: "renamed" }],
    }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-stale")).toEqual({
      error: "STALE",
      message: "Document has changed since the last read",
      current_revision: current,
    });
    expect(contentOf(tabId)).toBe(WORKFLOW);
  });

  it("patches what the editor holds, not the older text in the store", async () => {
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    editorHoldsUnflushed(tabId, WORKFLOW_TYPED);

    await handleWorkflowApplyPatch("req-patch", {
      tabId,
      patches: [{ kind: "job.set", jobId: "build", path: "runs-on", value: "macos-latest" }],
    }, TEST_WRITE_CONTEXT);

    expect(replyTo("req-patch").success).toBe(true);
    const patched = contentOf(tabId) ?? "";
    expect(patched).toContain("name: 用户改的名字");
    expect(patched).toContain("runs-on: macos-latest");
  });

  it("checks the revision after the flush, so one read before pending keystrokes is STALE", async () => {
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    const readRevision = useRevisionStore.getState().getRevision(tabId);
    editorHoldsUnflushed(tabId, WORKFLOW_TYPED);

    await handleWorkflowApplyPatch("req-late", {
      tabId,
      expected_revision: readRevision,
      patches: [{ kind: "workflow.set", path: "name", value: "renamed" }],
    }, TEST_WRITE_CONTEXT);

    expect(errorOf("req-late").error).toBe("STALE");
    expect(contentOf(tabId)).toBe(WORKFLOW_TYPED);
  });

  it("returns the revision the document is at after the patch, and journals the text it replaced", async () => {
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    const before = useRevisionStore.getState().getRevision(tabId);

    await handleWorkflowApplyPatch("req-rev", {
      tabId,
      patches: [{ kind: "workflow.set", path: "name", value: "renamed" }],
    }, TEST_WRITE_CONTEXT);

    const reply = replyTo("req-rev");
    const current = useRevisionStore.getState().getRevision(tabId);
    expect(reply.data).toEqual({ revision: current, applied: true, durable: true });
    expect(current).not.toBe(before);
    expect(agentJournalFake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ docKey: `path:${WORKFLOW_PATH}`, preimage: WORKFLOW, tool: "workflow.apply_patch" }),
    );
  });
});

describe("workflow.validate", () => {
  it("lints what the editor holds, not the older text in the store", async () => {
    useSettingsStore.setState((s) => ({ advanced: { ...s.advanced, workflowActionlint: true } }));
    const tabId = openTab(WORKFLOW_PATH, WORKFLOW);
    editorHoldsUnflushed(tabId, WORKFLOW_TYPED);

    await handleWorkflowValidate("req-lint", { tabId });

    expect(replyTo("req-lint")).toMatchObject({ success: true, data: { ok: true } });
    const linted = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "gha_lint")
      .map(([, args]) => (args as { yaml: string }).yaml);
    expect(linted).toEqual([WORKFLOW_TYPED]);
  });
});

describe("workspace.close", () => {
  it("refuses as DIRTY a tab whose unsaved keystrokes are still in the editor", async () => {
    const tabId = openTab("/w/a.md", "saved\n");
    editorHoldsUnflushed(tabId, "saved\n正在输入的内容\n");

    await handleWorkspaceClose("req-close", { tabId });

    expect(replyTo("req-close")).toMatchObject({
      success: true,
      data: { closed: false, reason: "DIRTY" },
    });
    expect(useTabStore.getState().findTabById(tabId)).not.toBeNull();
    expect(contentOf(tabId)).toBe("saved\n正在输入的内容\n");
  });

  it("still closes a tab that is clean once the editor has been flushed", async () => {
    const tabId = openTab("/w/a.md", "saved\n");
    editorHoldsUnflushed(tabId, "saved\n");

    await handleWorkspaceClose("req-clean", { tabId });

    expect(replyTo("req-clean")).toMatchObject({ success: true, data: { closed: true } });
    expect(useTabStore.getState().findTabById(tabId)).toBeNull();
  });

  it.each([
    { name: "a missing tabId", args: {}, message: "tabId is required" },
    { name: "a tabId of the wrong type", args: { tabId: 7 }, message: "tabId is required" },
    { name: "an empty tabId", args: { tabId: "" }, message: "Unknown tabId" },
    { name: "an unknown tabId", args: { tabId: "ghost" }, message: "Unknown tabId" },
  ])("refuses $name", async ({ args, message }) => {
    openTab("/w/a.md", "saved\n");

    await handleWorkspaceClose("req-bad", args);

    expect(errorOf("req-bad")).toEqual({ error: "INVALID_TAB", message });
  });

  it.each([
    { owner: "human", force: false },
    { owner: "human", force: true },
    { owner: "ai-sandbox", force: true },
  ] as const)(
    "refuses a $owner browser tab (force: $force): the browser tool closes those",
    async ({ owner, force }) => {
      const browserTabId = useTabStore
        .getState()
        .createBrowserTab(MAIN, "https://example.com/", "Example", owner);

      await handleWorkspaceClose("req-browser", { tabId: browserTabId, force });

      const err = errorOf("req-browser");
      expect(err.error).toBe("INVALID_TAB");
      expect(err.message).toContain("browser tab");
      expect(useTabStore.getState().findTabById(browserTabId)).not.toBeNull();
    },
  );
});

describe("workspace.open", () => {
  it("does not reload an open tab whose unsaved keystrokes are still in the editor", async () => {
    const tabId = openTab("/w/a.md", "saved\n");
    editorHoldsUnflushed(tabId, "saved\n正在输入的内容\n");
    fileText.mockResolvedValue("what is on disk\n");

    await handleWorkspaceOpen("req-open", { filePath: "/w/a.md" });

    expect(replyTo("req-open")).toMatchObject({
      success: true,
      data: { tabId, alreadyOpen: true, reloaded: false },
    });
    expect(contentOf(tabId)).toBe("saved\n正在输入的内容\n");
  });

  it("still reloads an open tab that is clean once the editor has been flushed", async () => {
    const tabId = openTab("/w/a.md", "saved\n");
    editorHoldsUnflushed(tabId, "saved\n");
    fileText.mockResolvedValue("what is on disk\n");

    await handleWorkspaceOpen("req-reload", { filePath: "/w/a.md" });

    expect(replyTo("req-reload")).toMatchObject({
      success: true,
      data: { tabId, alreadyOpen: true, reloaded: true },
    });
    expect(contentOf(tabId)).toBe("what is on disk\n");
  });

  it.each([
    { name: "a missing filePath", args: {} },
    { name: "an empty filePath", args: { filePath: "" } },
    { name: "a filePath of the wrong type", args: { filePath: 7 } },
  ])("refuses $name without reading anything", async ({ args }) => {
    await handleWorkspaceOpen("req-nopath", args);

    expect(errorOf("req-nopath")).toEqual({
      error: "INVALID_PATH",
      message: "filePath must be a non-empty string",
    });
    expect(fileText).not.toHaveBeenCalled();
  });
});

describe("session.get_state", () => {
  it("reports a tab dirty when its unsaved keystrokes are still in the editor", async () => {
    const tabId = openTab("/w/a.md", "saved\n");
    editorHoldsUnflushed(tabId, "saved\n正在输入的内容\n");

    await handleSessionGetState("req-state", "0.0.0-test", {});

    const state = replyTo("req-state").data as SessionState;
    const tab = state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId);
    expect(tab).toMatchObject({ dirty: true });
    expect(tab).toMatchObject({ revision: useRevisionStore.getState().getRevision(tabId) });
  });

  it("answers a request that carries no arguments at all", async () => {
    openTab("/w/a.md", "saved\n");

    await handleSessionGetState("req-bare", "0.0.0-test");

    expect(replyTo("req-bare").success).toBe(true);
  });
});
