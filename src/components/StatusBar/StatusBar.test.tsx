/**
 * StatusBar — accessibility regression tests.
 *
 * Focused coverage for the sidebar-toggle button's ARIA state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// --- Mocks ---

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentLastAutoSave: () => null,
  useDocumentIsMissing: () => false,
  useDocumentIsDivergent: () => false,
}));

vi.mock("@/hooks/useMcpServer", () => ({
  useMcpServer: () => ({
    running: false,
    loading: false,
    error: null,
    port: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMcpClients", () => ({
  useMcpClients: () => [],
}));

vi.mock("@/hooks/useTabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(),
}));

vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: vi.fn(),
}));

vi.mock("./useStatusBarTabDrag", () => ({
  useStatusBarTabDrag: () => ({
    getTabDragHandlers: () => ({ onPointerDown: vi.fn() }),
    isDragging: false,
    isReordering: false,
    dragMode: "idle",
    dragTabId: null,
    dropIndex: null,
    dragPoint: null,
    snapbackTabId: null,
    isDropPreviewTarget: false,
    isDropInvalid: false,
    isReorderBlocked: false,
    dragHint: null,
    ariaAnnouncement: "",
    handleTabKeyDown: vi.fn(),
  }),
}));

vi.mock("./useQuitFeedback", () => ({
  useQuitFeedback: () => false,
}));

vi.mock("./StatusBarRight", () => ({
  StatusBarRight: () => <div data-testid="status-bar-right" />,
}));

vi.mock("@/components/Tabs/Tab", () => ({
  Tab: () => <div data-testid="tab" />,
}));

vi.mock("@/components/Tabs/TabContextMenu", () => ({
  TabContextMenu: () => null,
}));

import { StatusBar } from "./StatusBar";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";

describe("StatusBar accessibility", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarVisible: false, statusBarVisible: true });
    useShortcutsStore.setState({ customBindings: {} });
  });

  it("exposes aria-expanded=false on the sidebar-toggle button when the sidebar is collapsed", () => {
    render(<StatusBar />);
    const toggle = screen.getByLabelText(/open sidebar/i);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  // WI-2.3 — the toggle button should disappear entirely when the sidebar
  // is already open. This and the test above together fully cover the
  // `aria-expanded={sidebarVisible}` binding (the button never renders
  // with `aria-expanded="true"` because of the surrounding conditional).
  it("does not render the toggle when the sidebar is already open", () => {
    useUIStore.setState({ sidebarVisible: true, statusBarVisible: true });
    render(<StatusBar />);
    expect(screen.queryByLabelText(/open sidebar/i)).toBeNull();
  });

  it("open-sidebar tooltip surfaces the shortcut, with title/aria-label parity", () => {
    render(<StatusBar />);
    const toggle = screen.getByLabelText(/open sidebar/i);
    const display = formatKeyForDisplay(useShortcutsStore.getState().getShortcut("toggleSidebar"));
    expect(display).not.toBe("");
    expect(toggle.getAttribute("title")).toContain(display);
    expect(toggle.getAttribute("title")).toBe(toggle.getAttribute("aria-label"));
  });
});

describe("StatusBar — browser workspace (WI-S1.3)", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarVisible: true, statusBarVisible: true });
    useTabStore.setState({
      tabs: {},
      activeTabId: {},
      untitledCounter: 0,
      closedTabs: {},
    });
  });

  it("shows one Browser workspace tab and hides editor controls when a browser page is active", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://example.com/", "Ex");
    useTabStore.getState().setActiveTab("main", id);
    render(<StatusBar />);
    expect(screen.getByRole("tab", { name: "Browser" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("status-bar-right")).toBeNull();
    expect(document.querySelector(".status-bar--browser")).toBeInTheDocument();
  });

  it("shows the editor controls (not the omnibox) when a document tab is active", () => {
    const id = useTabStore.getState().createTab("main", null);
    useTabStore.getState().setActiveTab("main", id);
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar-right")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // The browser workspace remains discoverable when the user hides the normal
  // status content; its top chrome owns navigation independently.
  it("still renders the Browser workspace tab when the status bar is hidden (F7)", () => {
    useUIStore.setState({ sidebarVisible: true, statusBarVisible: false });
    const id = useTabStore.getState().createBrowserTab("main", "https://example.com/", "Ex");
    useTabStore.getState().setActiveTab("main", id);
    render(<StatusBar />);
    expect(screen.getByRole("tab", { name: "Browser" })).toBeInTheDocument();
  });

  it("still hides the bar for a document tab when the status bar is hidden (F7)", () => {
    useUIStore.setState({ sidebarVisible: true, statusBarVisible: false });
    const id = useTabStore.getState().createTab("main", null);
    useTabStore.getState().setActiveTab("main", id);
    const { container } = render(<StatusBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
