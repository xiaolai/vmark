import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TabContextMenu } from "./TabContextMenu";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, type DocumentState } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const mocks = vi.hoisted(() => ({
  closeTabWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
  closeTabsWithDirtyCheck: vi.fn(() => Promise.resolve(true)),
  saveToPath: vi.fn(() => Promise.resolve(true)),
  reloadTabFromDisk: vi.fn(() => Promise.resolve()),
  ask: vi.fn(() => Promise.resolve(true)),
  writeText: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
  invoke: vi.fn(() => Promise.resolve("doc-2")),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: mocks.closeTabWithDirtyCheck,
  closeTabsWithDirtyCheck: mocks.closeTabsWithDirtyCheck,
}));

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: mocks.saveToPath,
}));

vi.mock("@/utils/reloadFromDisk", () => ({
  reloadTabFromDisk: mocks.reloadTabFromDisk,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: mocks.ask,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: mocks.revealItemInDir,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "doc-1" }),
}));

vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: () => false,
}));

function buildDocument(filePath: string): DocumentState {
  return {
    content: "# hello",
    savedContent: "# hello",
    lastDiskContent: "# hello",
    filePath,
    isDirty: false,
    documentId: 0,
    cursorInfo: null,
    lastAutoSave: null,
    isMissing: false,
    isDivergent: false,
    lineEnding: "unknown",
    hardBreakStyle: "unknown",
  };
}

function seedStores({ onlyOneTab = false }: { onlyOneTab?: boolean } = {}) {
  const tabs = onlyOneTab
    ? [{ id: "tab-1", title: "One", filePath: "/workspace/project/one.md", isPinned: false }]
    : [
        { id: "tab-1", title: "One", filePath: "/workspace/project/one.md", isPinned: false },
        { id: "tab-2", title: "Two", filePath: "/workspace/project/two.md", isPinned: false },
      ];

  useTabStore.setState({
    tabs: { main: tabs },
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
    closedTabs: {},
  });

  useDocumentStore.setState({
    documents: {
      "tab-1": buildDocument("/workspace/project/one.md"),
      "tab-2": buildDocument("/workspace/project/two.md"),
    },
  });

  useWorkspaceStore.setState({
    rootPath: "/workspace",
    isWorkspaceMode: true,
    config: null,
  });
}

describe("TabContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStores();
  });

  it("renders improved labels and menu semantics", () => {
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("menu", { name: "Tab actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy Relative Path" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Close Tabs to the Right" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Close All Unpinned Tabs" })).toBeInTheDocument();
  });

  it("shows a keyboard shortcut hint for Close", () => {
    const { container } = render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={vi.fn()}
      />
    );

    const closeButton = screen
      .getAllByRole("menuitem")
      .find((item) => item.querySelector(".tab-context-menu-item-label")?.textContent === "Close");
    if (!closeButton) {
      throw new Error("Close menu item not found");
    }
    const shortcut = closeButton.querySelector(".tab-context-menu-item-shortcut")
      ?? container.querySelector(".tab-context-menu-item-shortcut");
    expect(shortcut?.textContent?.length).toBeGreaterThan(0);
  });

  it("supports keyboard navigation and activation", async () => {
    const onClose = vi.fn();
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={onClose}
      />
    );

    const menu = screen.getByRole("menu", { name: "Tab actions" });

    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("Move to New Window");
    });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });

    expect(useTabStore.getState().tabs.main[0]?.isPinned).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when pressing Tab", () => {
    const onClose = vi.fn();
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={onClose}
      />
    );

    fireEvent.keyDown(screen.getByRole("menu", { name: "Tab actions" }), { key: "Tab" });
    expect(onClose).toHaveBeenCalled();
  });

  it("disables move to new window for last main tab", () => {
    seedStores({ onlyOneTab: true });
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("menuitem", { name: "Move to New Window" })).toBeDisabled();
  });

  it("copies relative path when workspace root is available", async () => {
    const onClose = vi.fn();
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Relative Path" }));

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith("project/one.md");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error toast when copy path fails", async () => {
    mocks.writeText.mockRejectedValueOnce(new Error("copy failed"));

    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Path" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to copy path.");
    });
  });

  it("reveals the file in file manager", async () => {
    render(
      <TabContextMenu
        tab={useTabStore.getState().tabs.main[0]}
        position={{ x: 100, y: 100 }}
        windowLabel="main"
        onClose={vi.fn()}
      />
    );

    const reveal = screen.getByRole("menuitem", { name: /Reveal in Finder|Show in Explorer|Show in File Manager/ });
    fireEvent.click(reveal);

    await waitFor(() => {
      expect(mocks.revealItemInDir).toHaveBeenCalledWith("/workspace/project/one.md");
    });
  });

  describe("Revert to Saved", () => {
    it("is hidden when document is clean", () => {
      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByRole("menuitem", { name: "Revert to Saved" })).not.toBeInTheDocument();
    });

    it("is hidden when file is missing", () => {
      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...buildDocument("/workspace/project/one.md"),
            isDirty: true,
            isMissing: true,
          },
        },
      });

      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByRole("menuitem", { name: "Revert to Saved" })).not.toBeInTheDocument();
    });

    it("is visible when dirty with file path and not missing", () => {
      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...buildDocument("/workspace/project/one.md"),
            isDirty: true,
          },
        },
      });

      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole("menuitem", { name: "Revert to Saved" })).toBeInTheDocument();
    });

    it("reloads from disk on confirm", async () => {
      const onClose = vi.fn();
      mocks.ask.mockResolvedValue(true);

      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...buildDocument("/workspace/project/one.md"),
            isDirty: true,
          },
        },
      });

      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Revert to Saved" }));

      await waitFor(() => {
        expect(mocks.reloadTabFromDisk).toHaveBeenCalledWith("tab-1", "/workspace/project/one.md");
      });
      expect(mocks.toast.success).toHaveBeenCalledWith("Reverted to saved version.");
      expect(onClose).toHaveBeenCalled();
    });

    it("does nothing on cancel", async () => {
      const onClose = vi.fn();
      mocks.ask.mockResolvedValue(false);

      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...buildDocument("/workspace/project/one.md"),
            isDirty: true,
          },
        },
      });

      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Revert to Saved" }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(mocks.reloadTabFromDisk).not.toHaveBeenCalled();
    });

    it("shows error toast on reload failure", async () => {
      const onClose = vi.fn();
      mocks.ask.mockResolvedValue(true);
      mocks.reloadTabFromDisk.mockRejectedValueOnce(new Error("read failed"));

      useDocumentStore.setState({
        documents: {
          ...useDocumentStore.getState().documents,
          "tab-1": {
            ...buildDocument("/workspace/project/one.md"),
            isDirty: true,
          },
        },
      });

      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Revert to Saved" }));

      await waitFor(() => {
        expect(mocks.toast.error).toHaveBeenCalledWith("Failed to revert to saved version.");
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Close All", () => {
    it("always appears in the menu", () => {
      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={vi.fn()}
        />
      );

      const item = screen.getByRole("menuitem", { name: "Close All" });
      expect(item).toBeInTheDocument();
      expect(item).not.toBeDisabled();
    });

    it("closes all tabs including pinned", async () => {
      // Pin tab-1
      useTabStore.getState().togglePin("main", "tab-1");
      expect(useTabStore.getState().tabs.main[0]?.isPinned).toBe(true);

      const onClose = vi.fn();
      render(
        <TabContextMenu
          tab={useTabStore.getState().tabs.main[0]}
          position={{ x: 100, y: 100 }}
          windowLabel="main"
          onClose={onClose}
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "Close All" }));

      await waitFor(() => {
        expect(mocks.closeTabsWithDirtyCheck).toHaveBeenCalledWith("main", ["tab-1", "tab-2"]);
      });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
