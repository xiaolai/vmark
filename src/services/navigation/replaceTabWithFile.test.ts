// @vitest-environment node
/**
 * replaceTabWithFile — the shared "load a file into an existing tab" flow
 * behind Cmd+O replace, Open Recent and Reopen Closed Tab.
 *
 * Mocked at the boundaries only: plugin-fs (the bytes on disk), `invoke`
 * (the Rust size probe), the huge-file prompts, and the workspace opener.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileBytes } from "@/test/fileBytes";

const diskText = vi.fn<(path: string) => unknown>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (path: string) => fileBytes(diskText(path)),
}));

const fileSize = vi.fn<(path: string) => unknown>(() => 10);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { path: string }) => {
    if (cmd === "get_file_size_bytes") return Promise.resolve(fileSize(args.path));
    if (cmd === "count_markdown_blocks") return Promise.resolve(1);
    return Promise.reject(new Error(`unexpected invoke(${cmd})`));
  },
}));

const showHugeFileRefusal = vi.fn(() => Promise.resolve());
vi.mock("@/services/dialogs/largeFilePrompts", () => ({
  showHugeFileRefusal: () => showHugeFileRefusal(),
  confirmOpenHugeFile: () => Promise.resolve(true),
}));

const openWorkspaceWithConfig = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...args: unknown[]) => openWorkspaceWithConfig(...args),
}));

import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { replaceTabWithFile } from "./replaceTabWithFile";

const W = "main";

function untitledTab(): string {
  const id = useTabStore.getState().createTab(W, null);
  useDocumentStore.getState().initDocument(id, "", null);
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  fileSize.mockImplementation(() => 10);
  rebootstrapFormats();
  useTabStore.getState().removeWindow(W);
  for (const id of Object.keys(useDocumentStore.getState().documents)) {
    useDocumentStore.getState().removeDocument(id);
  }
});

describe("replaceTabWithFile", () => {
  it("loads the file into the SAME tab as a clean document and records it", async () => {
    diskText.mockReturnValue("# Notes");
    const addFile = vi.spyOn(useRecentFilesStore.getState(), "addFile");
    const tabId = untitledTab();

    const result = await replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/docs/notes.md",
      sourcePath: "/docs/notes.md",
    });

    expect(result).toEqual({ ok: true });
    expect(useTabStore.getState().getTabsByWindow(W).map((t) => t.id)).toEqual([tabId]);
    const doc = useDocumentStore.getState().getDocument(tabId);
    expect(doc?.content).toBe("# Notes");
    expect(doc?.filePath).toBe("/docs/notes.md");
    expect(doc?.isDirty).toBe(false);
    expect(useTabStore.getState().findTabByPath(W, "/docs/notes.md")?.id).toBe(tabId);
    expect(addFile).toHaveBeenCalledWith("/docs/notes.md");
    expect(openWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("opens the workspace it is given, for the calling window", async () => {
    diskText.mockReturnValue("x");
    const tabId = untitledTab();

    await replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/repo/a.md",
      sourcePath: "/repo/a.md",
      workspaceRoot: "/repo",
    });

    expect(openWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: W });
  });

  it("never reads a media file as text: path only, empty content", async () => {
    const tabId = untitledTab();

    const result = await replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/pics/photo.png",
      sourcePath: "/pics/photo.png",
    });

    expect(result).toEqual({ ok: true });
    expect(diskText).not.toHaveBeenCalled();
    const tab = useTabStore.getState().findTabById(tabId);
    expect(tab && "formatId" in tab ? tab.formatId : null).toBe("media");
    expect(useDocumentStore.getState().getDocument(tabId)?.content).toBe("");
  });

  it("reports a refused file as cancelled without reading it or touching the tab", async () => {
    fileSize.mockImplementation(() => Number.MAX_SAFE_INTEGER);
    const tabId = untitledTab();

    const result = await replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/huge.md",
      sourcePath: "/huge.md",
    });

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(showHugeFileRefusal).toHaveBeenCalled();
    expect(diskText).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().getDocument(tabId)?.filePath).toBeNull();
  });

  it("does not resurrect a tab closed while the read was in flight", async () => {
    let release: (text: string) => void = () => {};
    diskText.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));
    const tabId = untitledTab();

    const pending = replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/docs/late.md",
      sourcePath: "/docs/late.md",
    });
    await vi.waitFor(() => expect(diskText).toHaveBeenCalled());
    useTabStore.getState().detachTab(W, tabId);
    useDocumentStore.getState().removeDocument(tabId);
    release("late");

    await expect(pending).resolves.toEqual({ ok: false, cancelled: true });
    expect(useDocumentStore.getState().getDocument(tabId)).toBeUndefined();
  });

  it("hands a read failure back to the caller and leaves the document as it was", async () => {
    const boom = new Error("EACCES");
    diskText.mockReturnValue(Promise.reject(boom));
    const tabId = untitledTab();

    const result = await replaceTabWithFile({
      windowLabel: W,
      tabId,
      targetPath: "/locked.md",
      sourcePath: "/locked.md",
    });

    expect(result).toEqual({ ok: false, cancelled: false, error: boom });
    expect(useDocumentStore.getState().getDocument(tabId)?.filePath).toBeNull();
  });
});
