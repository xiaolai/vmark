/**
 * runWindowCloseFlow — revalidation after EVERY await (review findings): the
 * pin dialog and the cleanup/persist steps inside finalize all yield, and an
 * edit landing mid-await must be re-prompted, never destroyed. Plus the
 * save-normalization artifact exemption (window half).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

const mockCleanup = vi.fn((_tabIds: string[]) => Promise.resolve());
vi.mock("@/services/media/closeCleanup", () => ({
  cleanupOrphansForClosingTabs: (tabIds: string[]) => mockCleanup(tabIds),
}));

const mockPersist = vi.fn(() => Promise.resolve());
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...args: unknown[]) => mockPersist(...args),
}));

/** Mirror the real prompt: "saved" marks the doc saved (settled). */
const settleDoc = (ctx: { tabId: string; content: string }) =>
  useDocumentStore.getState().markSaved(ctx.tabId, ctx.content);
const mockPromptSingle = vi.fn(async (ctx: { tabId: string; content: string }) => {
  settleDoc(ctx);
  return { action: "saved" as const };
});
const mockPromptMulti = vi.fn(
  async (ctxs: Array<{ tabId: string; content: string }>) => {
    ctxs.forEach(settleDoc);
    return { action: "saved-all" as const };
  },
);
vi.mock("./closeSave", () => ({
  promptSaveForDirtyDocument: (...args: unknown[]) =>
    (mockPromptSingle as (...a: unknown[]) => unknown)(...args),
  promptSaveForMultipleDocuments: (...args: unknown[]) =>
    (mockPromptMulti as (...a: unknown[]) => unknown)(...args),
}));

const mockAsk = vi.fn(() => Promise.resolve(true));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => mockAsk(...args),
}));

import { runWindowCloseFlow } from "./windowCloseFlow";

const WINDOW = "main";
const log = () => {};

function resetStores() {
  useTabStore.getState().removeWindow(WINDOW);
  Object.keys(useDocumentStore.getState().documents).forEach((id) =>
    useDocumentStore.getState().removeDocument(id)
  );
}

function closeWindowCalls() {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "close_window");
}

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

// Cleanup and persistence are awaits between "all documents at rest" and the
// teardown — an edit (human or MCP) landing there was silently destroyed.
describe("runWindowCloseFlow — edit landing during finalize", () => {
  it("re-prompts instead of destroying an edit that lands during cleanup", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "clean", "/tmp/a.md");

    mockCleanup.mockImplementationOnce(async () => {
      // An MCP write lands while cleanup does its file IO.
      useDocumentStore.getState().setContent(tabId, "landed during cleanup");
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    // The mid-cleanup edit produced a PROMPT — it was not silently dropped.
    expect(mockPromptSingle).toHaveBeenCalledTimes(1);
    expect(mockPromptSingle).toHaveBeenCalledWith(
      expect.objectContaining({ content: "landed during cleanup" })
    );
    expect(closeWindowCalls()).toHaveLength(1);
  });

  it("re-prompts instead of destroying an edit that lands during persistence", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "clean", "/tmp/a.md");

    mockPersist.mockImplementationOnce(async () => {
      useDocumentStore.getState().setContent(tabId, "landed during persist");
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    expect(mockPromptSingle).toHaveBeenCalledWith(
      expect.objectContaining({ content: "landed during persist" })
    );
  });

  it("refuses when documents never come to rest — nothing torn down", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "clean", "/tmp/a.md");

    let n = 0;
    mockCleanup.mockImplementation(async () => {
      useDocumentStore.getState().setContent(tabId, `writer keeps going ${++n}`);
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(false);
    expect(closeWindowCalls()).toHaveLength(0);
    expect(useTabStore.getState().tabs[WINDOW]).toHaveLength(1);
    expect(useDocumentStore.getState().getDocument(tabId)).toBeDefined();
  });
});

// The pin dialog can sit open for minutes — the dirty set must be revalidated
// after it, not carried over from before.
describe("runWindowCloseFlow — edit landing during the pin dialog", () => {
  it("prompts for an edit that landed while the pin dialog was open", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(tabId, "clean", "/tmp/a.md");
    useTabStore.getState().togglePin(WINDOW, tabId);

    mockAsk.mockImplementationOnce(async () => {
      useDocumentStore.getState().setContent(tabId, "typed during pin dialog");
      return true; // the user confirms closing pinned tabs
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    expect(mockAsk).toHaveBeenCalledTimes(1); // pins are asked about once
    expect(mockPromptSingle).toHaveBeenCalledWith(
      expect.objectContaining({ content: "typed during pin dialog" })
    );
    expect(closeWindowCalls()).toHaveLength(1);
  });
});

// The window half of the save-normalization artifact: "saved" that leaves
// isDirty standing on an UNCHANGED buffer must not re-prompt, and must not
// exhaust the attempt bound into a refused close.
describe("runWindowCloseFlow — save-normalization artifact", () => {
  it("closes after one prompt when the save leaves isDirty on unchanged content", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/breaks.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/breaks.md");
    useDocumentStore.getState().setContent(tabId, "line  \nnext");

    mockPromptSingle.mockImplementationOnce(async (ctx) => {
      // The save normalizes hard breaks: saved bytes differ from the buffer,
      // so markSaved leaves isDirty TRUE with no edit having landed.
      useDocumentStore.getState().markSaved(ctx.tabId, "line\\\nnext");
      return { action: "saved" as const };
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    expect(mockPromptSingle).toHaveBeenCalledTimes(1);
    expect(closeWindowCalls()).toHaveLength(1);
  });

  it("applies the exemption per document in the multi-doc prompt", async () => {
    const a = useTabStore.getState().createTab(WINDOW, "/tmp/a.md");
    useDocumentStore.getState().initDocument(a, "v1", "/tmp/a.md");
    useDocumentStore.getState().setContent(a, "a  \nbreaks");
    const b = useTabStore.getState().createTab(WINDOW, "/tmp/b.md");
    useDocumentStore.getState().initDocument(b, "v1", "/tmp/b.md");
    useDocumentStore.getState().setContent(b, "plain");

    mockPromptMulti.mockImplementationOnce(async (ctxs) => {
      for (const ctx of ctxs) {
        // Doc a: normalization artifact. Doc b: clean save.
        const saved = ctx.tabId === a ? "a\\\nbreaks" : ctx.content;
        useDocumentStore.getState().markSaved(ctx.tabId, saved);
      }
      return { action: "saved-all" as const };
    });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    expect(mockPromptMulti).toHaveBeenCalledTimes(1);
    expect(mockPromptSingle).not.toHaveBeenCalled();
    expect(closeWindowCalls()).toHaveLength(1);
  });

  it("does NOT extend the exemption past a real edit", async () => {
    const tabId = useTabStore.getState().createTab(WINDOW, "/tmp/breaks.md");
    useDocumentStore.getState().initDocument(tabId, "v1", "/tmp/breaks.md");
    useDocumentStore.getState().setContent(tabId, "line  \nnext");

    mockPromptSingle
      .mockImplementationOnce(async (ctx) => {
        useDocumentStore.getState().markSaved(ctx.tabId, "line\\\nnext");
        // A concurrent write changes the buffer — the exemption must void.
        useDocumentStore.getState().setContent(ctx.tabId, "line  \nnext plus more");
        return { action: "saved" as const };
      })
      .mockImplementationOnce(async (ctx) => {
        settleDoc(ctx);
        return { action: "saved" as const };
      });

    const result = await runWindowCloseFlow(WINDOW, log);

    expect(result).toBe(true);
    expect(mockPromptSingle).toHaveBeenCalledTimes(2);
    expect(mockPromptSingle).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "line  \nnext plus more" })
    );
  });
});
