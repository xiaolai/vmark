/**
 * Tests for the split-editor command set.
 *
 * Covers: the three split-only commands are refused and hidden from search
 * while the window has no live split (so toggleSyncScroll cannot flip latent
 * state), and once a split is open each one has its effect on the real pane
 * store — sync scroll flips, focus alternates panes, close collapses the split.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/navigation/toggleSplitDocuments", () => ({
  toggleSplitDocuments: vi.fn(),
}));

import { executeCommand, searchCommands, _resetCommandBus } from "./CommandBus";
import { registerPaneCommands } from "./paneCommands";
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { toggleSplitDocuments } from "@/services/navigation/toggleSplitDocuments";

const SPLIT_ONLY = ["view.toggleSyncScroll", "view.closePane", "view.focusOtherPane"];

function split(windowLabel = "main") {
  return usePaneStore.getState().getSplit(windowLabel);
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetCommandBus();
  usePaneStore.setState({ byWindow: {} });
  const doc = (id: string) =>
    ({ kind: "document", id, filePath: `/w/${id}.md`, title: id, isPinned: false, formatId: "markdown" }) as const;
  useTabStore.setState({ tabs: { main: [doc("a"), doc("b")] }, activeTabId: { main: "a" }, untitledCounter: 0 });
  registerPaneCommands();
});

describe("pane commands without a split", () => {
  it.each(SPLIT_ONLY)("%s is refused and leaves the pane store untouched", async (id) => {
    const before = split();

    expect(await executeCommand(id, undefined, { windowLabel: "main" })).toBe(false);
    expect(split()).toEqual(before);
  });

  it("hides the split-only commands from search", () => {
    const ids = searchCommands("", { windowLabel: "main" }).map((r) => r.command.id);

    for (const id of SPLIT_ONLY) expect(ids).not.toContain(id);
    expect(ids).toContain("view.toggleSplitDocuments");
  });

  it("toggleSplitDocuments always runs, for the context window", async () => {
    expect(await executeCommand("view.toggleSplitDocuments", undefined, { windowLabel: "w2" })).toBe(true);
    expect(toggleSplitDocuments).toHaveBeenCalledWith("w2");
  });

  it("a split in ANOTHER window does not enable the commands here", async () => {
    usePaneStore.getState().openSplit("other", "b");

    expect(await executeCommand("view.toggleSyncScroll", undefined, { windowLabel: "main" })).toBe(false);
  });
});

describe("pane commands with a live split", () => {
  beforeEach(() => {
    usePaneStore.getState().openSplit("main", "b");
  });

  it("toggleSyncScroll flips the window's sync flag each time", async () => {
    const initial = split().syncScroll;

    await executeCommand("view.toggleSyncScroll", undefined, { windowLabel: "main" });
    expect(split().syncScroll).toBe(!initial);
    await executeCommand("view.toggleSyncScroll", undefined, { windowLabel: "main" });
    expect(split().syncScroll).toBe(initial);
  });

  it("focusOtherPane alternates the focused pane and mirrors it into the active tab", async () => {
    expect(split().focusedPane).toBe("secondary");

    await executeCommand("view.focusOtherPane", undefined, { windowLabel: "main" });
    expect(split().focusedPane).toBe("primary");
    expect(useTabStore.getState().activeTabId.main).toBe("a");

    await executeCommand("view.focusOtherPane", undefined, { windowLabel: "main" });
    expect(split().focusedPane).toBe("secondary");
    expect(useTabStore.getState().activeTabId.main).toBe("b");
  });

  it("closePane collapses the split onto the primary tab and re-disables the commands", async () => {
    expect(await executeCommand("view.closePane", undefined, { windowLabel: "main" })).toBe(true);

    expect(split().enabled).toBe(false);
    expect(useTabStore.getState().activeTabId.main).toBe("a");
    expect(await executeCommand("view.closePane", undefined, { windowLabel: "main" })).toBe(false);
  });

  it("defaults to the main window when the context names none", async () => {
    expect(await executeCommand("view.focusOtherPane")).toBe(true);
    expect(split().focusedPane).toBe("primary");
  });
});
