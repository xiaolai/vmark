/**
 * Tests for rebuildNativeMenu helper
 *
 * @module utils/rebuildNativeMenu.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rebuildNativeMenu } from "./rebuildNativeMenu";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const getAllShortcutsMock = vi.fn();
vi.mock("@/stores/shortcutsStore", () => ({
  useShortcutsStore: {
    getState: () => ({ getAllShortcuts: getAllShortcutsMock }),
  },
  // Keep DEFAULT_SHORTCUTS minimal: one entry with menuId, one without.
  DEFAULT_SHORTCUTS: [
    { id: "bold", menuId: "bold" },
    { id: "searchGenies", menuId: "search-genies" },
    { id: "noMenu", menuId: undefined },
  ],
  prosemirrorToTauri: (key: string) => (key === "" ? "" : `TAURI(${key})`),
}));

const recentFilesSyncMock = vi.fn();
vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({ syncToNativeMenu: recentFilesSyncMock }),
  },
}));

const recentWorkspacesSyncMock = vi.fn();
vi.mock("@/stores/recentWorkspacesStore", () => ({
  useRecentWorkspacesStore: {
    getState: () => ({ syncToNativeMenu: recentWorkspacesSyncMock }),
  },
}));

describe("rebuildNativeMenu", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    getAllShortcutsMock.mockReset();
    recentFilesSyncMock.mockReset();
    recentWorkspacesSyncMock.mockReset();
  });

  it("invokes rebuild_menu with translated shortcut map", async () => {
    getAllShortcutsMock.mockReturnValue({
      bold: "Mod-b",
      searchGenies: "Mod-Shift-g",
      noMenu: "Mod-x",
    });

    await rebuildNativeMenu();

    expect(invokeMock).toHaveBeenCalledWith("rebuild_menu", {
      shortcuts: {
        bold: "TAURI(Mod-b)",
        "search-genies": "TAURI(Mod-Shift-g)",
      },
    });
  });

  it("passes search-genies accel to refresh_genies_menu when present", async () => {
    getAllShortcutsMock.mockReturnValue({
      bold: "Mod-b",
      searchGenies: "Mod-Shift-g",
    });

    await rebuildNativeMenu();

    expect(invokeMock).toHaveBeenCalledWith("refresh_genies_menu", {
      shortcuts: { "search-genies": "TAURI(Mod-Shift-g)" },
    });
  });

  it("passes null to refresh_genies_menu when search-genies has no binding", async () => {
    getAllShortcutsMock.mockReturnValue({
      bold: "Mod-b",
      searchGenies: "",
    });

    await rebuildNativeMenu();

    expect(invokeMock).toHaveBeenCalledWith("refresh_genies_menu", {
      shortcuts: null,
    });
  });

  it("re-syncs recent files and workspaces after rebuild", async () => {
    getAllShortcutsMock.mockReturnValue({});

    await rebuildNativeMenu();

    expect(recentFilesSyncMock).toHaveBeenCalledTimes(1);
    expect(recentWorkspacesSyncMock).toHaveBeenCalledTimes(1);
  });

  it("calls invokes and syncs in the expected order: rebuild_menu, refresh_genies_menu, recent syncs", async () => {
    getAllShortcutsMock.mockReturnValue({ searchGenies: "Mod-g" });

    const sequence: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      sequence.push(`invoke:${cmd}`);
      return Promise.resolve();
    });
    recentFilesSyncMock.mockImplementation(() => sequence.push("recentFiles"));
    recentWorkspacesSyncMock.mockImplementation(() =>
      sequence.push("recentWorkspaces"),
    );

    await rebuildNativeMenu();

    expect(sequence).toEqual([
      "invoke:rebuild_menu",
      "invoke:refresh_genies_menu",
      "recentFiles",
      "recentWorkspaces",
    ]);
  });

  it("propagates rebuild_menu errors to the caller", async () => {
    getAllShortcutsMock.mockReturnValue({});
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "rebuild_menu") return Promise.reject(new Error("no menu"));
      return Promise.resolve();
    });

    await expect(rebuildNativeMenu()).rejects.toThrow("no menu");
    expect(recentFilesSyncMock).not.toHaveBeenCalled();
  });
});
