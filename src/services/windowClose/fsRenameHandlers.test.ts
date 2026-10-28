// @vitest-environment node
// WI-AL1.6 — a confirmed directory rename re-points the open tabs of the
// files under it, on path-component boundaries, without touching their
// buffers or their identity (the tab id is kept, nothing is re-read).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchRenames, handleRenameEvent } from "./fsRenameHandlers";
import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";
import type { FsChangeContext } from "./fsChangeContext";
import { normalizePath } from "@/utils/paths";
import { useDocumentStore } from "@/stores/documentStore";

function makeContext(over: Partial<FsChangeContext> = {}): FsChangeContext {
  return {
    readTextFile: vi.fn(async () => "disk content"),
    fileExists: vi.fn(async () => true),
    normalizePath: (p: string) => p,
    hasPendingSave: vi.fn(() => false),
    matchesPendingSave: vi.fn(() => false),
    isMedia: vi.fn(() => false),
    applyRename: vi.fn(),
    handleModifyEvent: vi.fn(async () => {}),
    handleDeletion: vi.fn(),
    isMissing: vi.fn(() => false),
    clearMissing: vi.fn(),
    markBinaryFileChanged: vi.fn(),
    ...over,
  };
}

/** Nothing about a rebased tab is re-read, reloaded or marked missing. */
function expectBuffersUntouched(ctx: FsChangeContext): void {
  expect(ctx.readTextFile).not.toHaveBeenCalled();
  expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
  expect(ctx.handleDeletion).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} });
});

describe("a renamed directory carries its open descendants", () => {
  it("re-points every open file under it, nested ones included", async () => {
    const ctx = makeContext();
    const openPaths = new Map([
      ["/ws/a/b/x.md", "tab-x"],
      ["/ws/a/b/deep/笔记 y.md", "tab-y"],
    ]);
    await handleRenameEvent(ctx, ["/ws/a/b", "/ws/a/c"], openPaths);
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-x", "/ws/a/c/x.md");
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-y", "/ws/a/c/deep/笔记 y.md");
    expect(ctx.applyRename).toHaveBeenCalledTimes(2);
    expectBuffersUntouched(ctx);
  });

  it("leaves siblings sharing a name prefix and the parent's other files alone", async () => {
    const ctx = makeContext();
    const openPaths = new Map([
      ["/ws/a/bc/x.md", "tab-bc"],
      ["/ws/a/b.md", "tab-bmd"],
      ["/ws/a/other.md", "tab-other"],
      ["/ws/a/b/x.md", "tab-x"],
    ]);
    await handleRenameEvent(ctx, ["/ws/a/b", "/ws/a/z"], openPaths);
    expect(ctx.applyRename).toHaveBeenCalledTimes(1);
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-x", "/ws/a/z/x.md");
  });

  it("matches Windows paths whichever separator the event used", async () => {
    const ctx = makeContext({ normalizePath });
    const openPaths = new Map([
      ["c:/ws/a/b/x.md", "tab-x"],
      ["c:/ws/a/bc/y.md", "tab-bc"],
    ]);
    await handleRenameEvent(ctx, ["C:\\ws\\a\\b", "C:\\ws\\a\\c"], openPaths);
    expect(ctx.applyRename).toHaveBeenCalledTimes(1);
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-x", "c:/ws/a/c/x.md");
  });

  it("an exact file rename still re-points only that file", async () => {
    const ctx = makeContext();
    const openPaths = new Map([
      ["/ws/a.md", "tab-a"],
      ["/ws/a.md/odd.md", "tab-odd"],
    ]);
    await handleRenameEvent(ctx, ["/ws/a.md", "/ws/b.md"], openPaths);
    expect(ctx.applyRename).toHaveBeenCalledTimes(1);
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-a", "/ws/b.md");
  });

  it("a pair with nothing open under it re-points nothing", async () => {
    const ctx = makeContext();
    await handleRenameEvent(ctx, ["/ws/a", "/ws/b"], new Map());
    await handleRenameEvent(ctx, ["", "/ws/b"], new Map([["/ws/x.md", "tab-x"]]));
    expect(ctx.applyRename).not.toHaveBeenCalled();
    expectBuffersUntouched(ctx);
  });

  it("a dirty descendant keeps its buffer, dirt and editor identity", async () => {
    const store = useDocumentStore.getState();
    store.initDocument("tab-x", "saved", "/ws/a/b/x.md");
    store.setEditorContent("tab-x", "unsaved edit");
    const before = useDocumentStore.getState().getDocument("tab-x");
    const ctx = makeContext({
      applyRename: (tabId, newPath) => useDocumentStore.getState().setFilePath(tabId, newPath),
    });
    await handleRenameEvent(ctx, ["/ws/a/b", "/ws/a/c"], new Map([["/ws/a/b/x.md", "tab-x"]]));
    const after = useDocumentStore.getState().getDocument("tab-x");
    expect(after?.filePath).toBe("/ws/a/c/x.md");
    expect(after?.content).toBe("unsaved edit");
    expect(after?.isDirty).toBe(true);
    expect(after?.documentId).toBe(before?.documentId);
    expectBuffersUntouched(ctx);
  });
});

/** A path map backed by `applyRename`, the way the store backs the real one. */
function liveTabs(initial: Array<[string, string]>) {
  const byTab = new Map(initial.map(([path, tabId]) => [tabId, path]));
  const ctx = makeContext({
    applyRename: vi.fn((tabId: string, path: string) => {
      byTab.set(tabId, path);
    }),
  });
  const getOpenPaths = () => new Map([...byTab].map(([tabId, path]) => [path, tabId]));
  return { ctx, getOpenPaths };
}

function renamed(path: string, over: Partial<SemanticWorkspaceEvent> = {}): SemanticWorkspaceEvent {
  return { kind: "renamed", path, rootPath: "/ws", selfWrite: false, ...over };
}

describe("dispatchRenames", () => {
  it("skips VMark's own atomic rename even after its pending save expired", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    // The pending save is gone by the time the queued event runs; the event's flag is not.
    await dispatchRenames(ctx, [renamed("/ws/a.md", { selfWrite: true })], getOpenPaths);
    expect(ctx.readTextFile).not.toHaveBeenCalled();
    expect(ctx.handleModifyEvent).not.toHaveBeenCalled();
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("still re-points a tab for a self-write pair: the move itself is a fact", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    await dispatchRenames(
      ctx,
      [renamed("/ws/b.md", { previousPath: "/ws/a.md", selfWrite: true })],
      getOpenPaths,
    );
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-a", "/ws/b.md");
  });

  it("probes a replacement of a at b when a is then renamed to b in the same batch", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    // The disk is already in its final state: a.md is gone, b.md holds the new bytes.
    ctx.readTextFile = vi.fn(async (p: string) => {
      if (p === "/ws/b.md") return "replaced";
      throw new Error("ENOENT");
    });
    ctx.fileExists = vi.fn(async (p: string) => p === "/ws/b.md");
    await dispatchRenames(
      ctx,
      [renamed("/ws/a.md"), renamed("/ws/b.md", { previousPath: "/ws/a.md" })],
      getOpenPaths,
    );
    expect(ctx.applyRename).toHaveBeenCalledWith("tab-a", "/ws/b.md");
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-a", "/ws/b.md", "replaced");
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("probes a paired atomic replacement at the final path of a later rename chain", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    ctx.readTextFile = vi.fn(async (p: string) => {
      if (p === "/ws/文档/c.md") return "new";
      throw new Error("ENOENT");
    });
    ctx.fileExists = vi.fn(async (p: string) => p === "/ws/文档/c.md");
    await dispatchRenames(
      ctx,
      [
        renamed("/ws/a.md", { previousPath: "/ws/.a.md.tmp" }),
        renamed("/ws/b.md", { previousPath: "/ws/a.md" }),
        renamed("/ws/文档/c.md", { previousPath: "/ws/b.md" }),
      ],
      getOpenPaths,
    );
    expect(ctx.handleModifyEvent).toHaveBeenCalledTimes(1);
    expect(ctx.handleModifyEvent).toHaveBeenCalledWith("tab-a", "/ws/文档/c.md", "new");
    expect(ctx.handleDeletion).not.toHaveBeenCalled();
  });

  it("probes a tab once however many events in the batch call for it", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    await dispatchRenames(ctx, [renamed("/ws/a.md"), renamed("/ws/a.md")], getOpenPaths);
    expect(ctx.handleModifyEvent).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty batch", async () => {
    const { ctx, getOpenPaths } = liveTabs([["/ws/a.md", "tab-a"]]);
    await dispatchRenames(ctx, [], getOpenPaths);
    expect(ctx.applyRename).not.toHaveBeenCalled();
    expect(ctx.readTextFile).not.toHaveBeenCalled();
  });
});
