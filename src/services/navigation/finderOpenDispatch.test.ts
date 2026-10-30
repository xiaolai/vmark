// @vitest-environment node
/**
 * dispatchFinderOpen — the rules of running one system file-open: which branch
 * runs, the size gate before a new window, cancellation, the drained-batch
 * override, and the re-read of the replaceable tab after the size route.
 *
 * Real tab, document, workspace and settings stores; mocked at the
 * boundaries — `invoke` (size probe and the new-window commands), the
 * huge-file prompts — and the hook's own collaborators in the context.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Size = number | Promise<number>;
const sizeOf = vi.fn<(path: string) => Size>(() => 10);
const openCommand = vi.fn<(cmd: string, args: unknown) => Promise<unknown>>(() =>
  Promise.resolve(undefined),
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { path: string }) => {
    if (cmd === "get_file_size_bytes") return Promise.resolve(sizeOf(args.path));
    if (cmd === "count_markdown_blocks") return Promise.resolve(1);
    return openCommand(cmd, args);
  },
}));
vi.mock("@/services/dialogs/largeFilePrompts", () => ({
  showHugeFileRefusal: () => Promise.resolve(),
  confirmOpenHugeFile: () => Promise.resolve(true),
}));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: () => Promise.resolve(),
}));

import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { FinderBranchContext } from "./finderOpenBranches";
import { dispatchFinderOpen } from "./finderOpenDispatch";

const W = "main";
const loadFileIntoTab = vi.fn(async (tabId: string, path: string) => {
  useDocumentStore.getState().ingestExternalContent(tabId, `# ${path}`, "disk-open", {
    filePath: path,
  });
});
const onOpenFailure = vi.fn();
let cancelled = false;
const ctx: FinderBranchContext = {
  windowLabel: W,
  isCancelled: () => cancelled,
  onOpenFailure,
  loadFileIntoTab,
};

const paths = () =>
  useTabStore.getState().getTabsByWindow(W).map((t) => ("filePath" in t ? t.filePath : null));
const sizeProbed = () => sizeOf.mock.calls.length > 0;

function setWorkspace(rootPath: string | null): void {
  useWorkspaceStore.setState({ rootPath, isWorkspaceMode: rootPath !== null });
}

beforeEach(() => {
  vi.clearAllMocks();
  sizeOf.mockImplementation(() => 10);
  openCommand.mockImplementation(() => Promise.resolve(undefined));
  cancelled = false;
  rebootstrapFormats();
  useTabStore.getState().removeWindow(W);
  for (const id of Object.keys(useDocumentStore.getState().documents)) {
    useDocumentStore.getState().removeDocument(id);
  }
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
  });
  setWorkspace("/repo");
});

describe("dispatchFinderOpen — already open", () => {
  it("activates the existing tab without probing the size or reading", async () => {
    const existing = useTabStore.getState().createTab(W, "/repo/a.md");
    useDocumentStore.getState().initDocument(existing, "# a", "/repo/a.md");
    useTabStore.getState().createTab(W, "/repo/b.md");

    await dispatchFinderOpen(ctx, "/repo/a.md", "/repo");

    expect(useTabStore.getState().activeTabId[W]).toBe(existing);
    expect(sizeProbed()).toBe(false);
    expect(loadFileIntoTab).not.toHaveBeenCalled();
  });
});

describe("dispatchFinderOpen — a different workspace opens a new window", () => {
  it("opens the incoming workspace with the file, creating no tab here", async () => {
    await dispatchFinderOpen(ctx, "/other/x.md", "/other");

    expect(openCommand).toHaveBeenCalledExactlyOnceWith("open_workspace_in_new_window", {
      workspaceRoot: "/other",
      filePath: "/other/x.md",
    });
    expect(paths()).toEqual([]);
  });

  it("opens a file with no workspace of its own in a plain new window", async () => {
    await dispatchFinderOpen(ctx, "/elsewhere/x.md", null);

    expect(openCommand).toHaveBeenCalledExactlyOnceWith("open_file_in_new_window", {
      path: "/elsewhere/x.md",
    });
  });

  it("opens nothing when the size gate refuses the file", async () => {
    sizeOf.mockImplementation(() => Number.MAX_SAFE_INTEGER);

    await dispatchFinderOpen(ctx, "/other/huge.md", "/other");

    expect(openCommand).not.toHaveBeenCalled();
  });

  it("opens nothing when the caller unmounted during the size route", async () => {
    sizeOf.mockImplementation(() => {
      cancelled = true;
      return 10;
    });

    await dispatchFinderOpen(ctx, "/other/x.md", "/other");

    expect(openCommand).not.toHaveBeenCalled();
  });

  it("still opens a drained batch after an unmount — nothing can fetch it again", async () => {
    cancelled = true;

    await dispatchFinderOpen(ctx, "/other/x.md", "/other", true);

    expect(openCommand).toHaveBeenCalledOnce();
  });

  it("reports a failed new-window open through the context", async () => {
    const refusal = new Error("not a registered format");
    openCommand.mockImplementation(() => Promise.reject(refusal));

    await dispatchFinderOpen(ctx, "/other/x.md", "/other");

    expect(onOpenFailure).toHaveBeenCalledExactlyOnceWith(refusal);
  });
});

describe("dispatchFinderOpen — landing in this window", () => {
  it("loads into the lone clean untitled tab instead of adding one", async () => {
    const untitled = useTabStore.getState().createTab(W, null);
    useDocumentStore.getState().initDocument(untitled, "", null);

    await dispatchFinderOpen(ctx, "/repo/notes.md", "/repo");

    expect(loadFileIntoTab).toHaveBeenCalledExactlyOnceWith(untitled, "/repo/notes.md");
    expect(paths()).toEqual(["/repo/notes.md"]);
  });

  it("adds a tab when the untitled tab was claimed while the size route was awaited", async () => {
    const untitled = useTabStore.getState().createTab(W, null);
    useDocumentStore.getState().initDocument(untitled, "", null);
    sizeOf.mockImplementation(() => {
      // The user starts typing in the untitled tab mid-route: it is no
      // longer replaceable, and loading into it would destroy that text.
      useDocumentStore.getState().setEditorContent(untitled, "typed meanwhile");
      return 10;
    });

    await dispatchFinderOpen(ctx, "/repo/notes.md", "/repo");

    expect(useDocumentStore.getState().getDocument(untitled)?.content).toBe("typed meanwhile");
    expect(paths()).toEqual([null, "/repo/notes.md"]);
  });

  it("adds a tab in rail mode even for a file from another folder", async () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
    });
    useTabStore.getState().createTab(W, "/repo/a.md");

    await dispatchFinderOpen(ctx, "/other/x.md", "/other");

    expect(openCommand).not.toHaveBeenCalled();
    expect(paths()).toEqual(["/repo/a.md", "/other/x.md"]);
  });
});
