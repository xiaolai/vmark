import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBarTabStrip } from "./StatusBarTabStrip";
import type { Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";

function makeTab(overrides: Partial<TabType> = {}): TabType {
  return {
    id: "t1",
    filePath: "/root/a.md",
    title: "a.md",
    isPinned: false,
    formatId: "markdown",
    ...overrides,
  };
}

const noopDrag = {
  getTabDragHandlers: () => ({ onPointerDown: vi.fn() }),
} as never;

function setup(props: Partial<Parameters<typeof StatusBarTabStrip>[0]> = {}) {
  return render(
    <StatusBarTabStrip
      tabs={[makeTab()]}
      activeTabId="t1"
      showTabs
      showNewTabButton
      isDragging={false}
      isReordering={false}
      dragTabId={null}
      dropIndex={null}
      isDropInvalid={false}
      isReorderBlocked={false}
      snapbackTabId={null}
      getTabDragHandlers={(noopDrag as { getTabDragHandlers: unknown }).getTabDragHandlers as never}
      onActivateTab={vi.fn()}
      onCloseTab={vi.fn()}
      onContextMenu={vi.fn()}
      onTabKeyDown={vi.fn()}
      onNewTab={vi.fn()}
      onActivateBrowserWorkspace={vi.fn()}
      {...props}
    />,
  );
}

describe("StatusBarTabStrip", () => {
  beforeEach(() => {
    // Ensure document-derived per-tab flags resolve to defaults.
    useDocumentStore.setState({ documents: {} } as never);
  });

  it("renders a tablist with one tab per entry", () => {
    setup({
      tabs: [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })],
    });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("marks the active tab via aria-selected", () => {
    setup({
      tabs: [makeTab({ id: "t1", title: "one" }), makeTab({ id: "t2", title: "two" })],
      activeTabId: "t2",
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });

  it("calls onNewTab when the new-tab button is clicked", async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    setup({ onNewTab });
    await user.click(screen.getByRole("button", { name: /new tab/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it("new-tab tooltip surfaces the shortcut, with title/aria-label parity", () => {
    useShortcutsStore.setState({ customBindings: {} });
    setup();
    const btn = screen.getByRole("button", { name: /new tab/i });
    const display = formatKeyForDisplay(useShortcutsStore.getState().getShortcut("newTab"));
    expect(display).not.toBe("");
    expect(btn.getAttribute("title")).toContain(display);
    expect(btn.getAttribute("title")).toBe(btn.getAttribute("aria-label"));
  });

  it("hides the new-tab button when showNewTabButton is false", () => {
    setup({ showNewTabButton: false });
    expect(
      screen.queryByRole("button", { name: /new tab/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onActivateTab with the tab id when a tab is clicked", async () => {
    const user = userEvent.setup();
    const onActivateTab = vi.fn();
    setup({ tabs: [makeTab({ id: "t1", title: "one" })], onActivateTab });
    await user.click(screen.getByRole("tab"));
    expect(onActivateTab).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("calls onCloseTab when a tab's close button is clicked", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();
    setup({
      tabs: [makeTab({ id: "t1", title: "one", isPinned: false })],
      onCloseTab,
    });
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onCloseTab).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("renders no tablist when showTabs is false", () => {
    setup({ showTabs: false });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  describe("browser workspace tab", () => {
    it("is absent when there are no browser pages", () => {
      setup({ browserWorkspaceCount: 0 });
      expect(screen.queryByRole("tab", { name: /browser/i })).not.toBeInTheDocument();
    });

    it("renders when there are browser pages", () => {
      setup({ browserWorkspaceCount: 2, browserWorkspaceActive: false });
      expect(screen.getByRole("tab", { name: /browser/i })).toBeInTheDocument();
    });

    it("activates the workspace on click", async () => {
      const user = userEvent.setup();
      const onActivateBrowserWorkspace = vi.fn();
      setup({ browserWorkspaceCount: 1, onActivateBrowserWorkspace });
      await user.click(screen.getByRole("tab", { name: /browser/i }));
      expect(onActivateBrowserWorkspace).toHaveBeenCalledOnce();
    });

    it("activates the workspace on Enter (native button)", async () => {
      const user = userEvent.setup();
      const onActivateBrowserWorkspace = vi.fn();
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: true, onActivateBrowserWorkspace });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      wsTab.focus();
      await user.keyboard("{Enter}");
      expect(onActivateBrowserWorkspace).toHaveBeenCalled();
    });

    it("is focusable (tabindex 0) and excluded from drop math when active", () => {
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: true });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      expect(wsTab).toHaveAttribute("tabindex", "0");
      expect(wsTab).toHaveAttribute("data-workspace-tab");
    });

    it("has roving tabindex -1 when not the active tab", () => {
      setup({ browserWorkspaceCount: 1, browserWorkspaceActive: false });
      expect(screen.getByRole("tab", { name: /browser/i })).toHaveAttribute("tabindex", "-1");
    });

    it("renders the trailing drop indicator before the workspace tab", () => {
      setup({
        tabs: [makeTab({ id: "t1", title: "one" })],
        browserWorkspaceCount: 1,
        isReordering: true,
        dropIndex: 1, // >= documentTabs.length → end-of-documents drop
        dragTabId: "t1",
      });
      const tablist = screen.getByRole("tablist");
      const indicator = tablist.querySelector(".tab-drop-indicator");
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      expect(indicator).toBeInTheDocument();
      // The indicator must precede the synthetic workspace tab in the DOM.
      expect(
        indicator!.compareDocumentPosition(wsTab) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("ArrowLeft moves focus from the workspace tab to the preceding document tab", () => {
      setup({
        tabs: [makeTab({ id: "t1", title: "one" })],
        activeTabId: null as never,
        browserWorkspaceCount: 1,
        browserWorkspaceActive: true,
      });
      const wsTab = screen.getByRole("tab", { name: /browser/i });
      const docTab = screen.getByRole("tab", { name: /one/i });
      wsTab.focus();
      fireEvent.keyDown(wsTab, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(docTab);
    });
  });
});
