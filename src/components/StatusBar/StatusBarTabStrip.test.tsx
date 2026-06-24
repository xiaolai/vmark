import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBarTabStrip } from "./StatusBarTabStrip";
import type { Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

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
});
