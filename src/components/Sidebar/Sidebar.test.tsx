/**
 * Sidebar component tests.
 *
 * Locks the WI-2.3 a11y wiring: the close-sidebar footer button binds
 * aria-expanded to live store state (not a hardcoded literal) so screen
 * readers report the correct collapse state.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { Sidebar } from "./Sidebar";
import { useTabStore } from "@/stores/tabStore";

// FileExplorer pulls in the workspace stack (Tauri FS, watchers, etc.) which
// is irrelevant to these assertions. Stub it to a static node so the test
// stays focused on the Sidebar shell wiring.
// The sidebar now follows the active tab's KIND (WI-S2.1), so it needs a window.
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));
vi.mock("@/components/Browser/BrowserHistoryView", () => ({
  BrowserHistoryView: () => <div data-testid="browser-history-view" />,
}));
vi.mock("@/components/Browser/BookmarksView", () => ({
  BookmarksView: () => <div data-testid="bookmarks-view" />,
}));

vi.mock("./FileExplorer", () => ({
  FileExplorer: () => null,
}));

vi.mock("./OutlineView", () => ({
  OutlineView: () => null,
}));

vi.mock("./HistoryView", () => ({
  HistoryView: () => null,
}));

// useDocumentFilePath reaches into editor/tab state we don't want to
// bootstrap here — keep it null for the default view.
vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentFilePath: () => null,
}));

describe("Sidebar — close button aria-expanded", () => {
  beforeEach(() => {
    // Reset to a known-good shape between tests so live-state assertions
    // don't leak across runs.
    useUIStore.setState({
      sidebarVisible: true,
      sidebarViewMode: "files",
    });
  });

  it("reports aria-expanded='true' when sidebar is visible", () => {
    useUIStore.setState({ sidebarVisible: true });
    render(<Sidebar />);
    const closeBtn = screen.getByRole("button", { name: /close sidebar/i });
    expect(closeBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("reports aria-expanded='false' when sidebar state is collapsed", () => {
    // The button only renders when the sidebar shell is mounted, but the
    // attribute must still reflect the live store value — guards against a
    // future regression that hardcodes the attribute to true.
    useUIStore.setState({ sidebarVisible: false });
    render(<Sidebar />);
    const closeBtn = screen.getByRole("button", { name: /close sidebar/i });
    expect(closeBtn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Sidebar — tooltips surface shortcuts", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarVisible: true, sidebarViewMode: "files" });
    useShortcutsStore.setState({ customBindings: {} });
  });

  it("close-sidebar tooltip includes the shortcut, with title/aria-label parity", () => {
    render(<Sidebar />);
    const closeBtn = screen.getByRole("button", { name: /close sidebar/i });
    const display = formatKeyForDisplay(useShortcutsStore.getState().getShortcut("toggleSidebar"));
    expect(display).not.toBe("");
    expect(closeBtn.getAttribute("title")).toContain(display);
    expect(closeBtn.getAttribute("title")).toBe(closeBtn.getAttribute("aria-label"));
  });

  it("new-file tooltip includes the shortcut, with title/aria-label parity", () => {
    render(<Sidebar />);
    const newFileBtn = screen.getByRole("button", { name: /new file/i });
    const display = formatKeyForDisplay(useShortcutsStore.getState().getShortcut("newFile"));
    expect(display).not.toBe("");
    expect(newFileBtn.getAttribute("title")).toContain(display);
    expect(newFileBtn.getAttribute("title")).toBe(newFileBtn.getAttribute("aria-label"));
  });
});

// WI-S2.1 — the sidebar follows the active tab's kind (ADR-2). No manual switch: the
// sidebar reflects what you are actually looking at.
describe("Sidebar — follows the active tab's kind", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
    useUIStore.setState({
      sidebarVisible: true,
      sidebarViewMode: "outline",
      sidebarBrowserViewMode: "browser-history",
    });
  });

  it("shows document views for a document tab", () => {
    const id = useTabStore.getState().createTab("main", null);
    useTabStore.getState().setActiveTab("main", id);
    render(<Sidebar />);
    expect(screen.queryByTestId("browser-history-view")).toBeNull();
  });

  it("shows browser history for a browser tab, with no manual switch", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://a.com/", "A");
    useTabStore.getState().setActiveTab("main", id);
    render(<Sidebar />);
    expect(screen.getByTestId("browser-history-view")).toBeInTheDocument();
  });

  it("shows bookmarks when that is the remembered browser sub-view", () => {
    const id = useTabStore.getState().createBrowserTab("main", "https://a.com/", "A");
    useTabStore.getState().setActiveTab("main", id);
    useUIStore.setState({ sidebarBrowserViewMode: "bookmarks" });
    render(<Sidebar />);
    expect(screen.getByTestId("bookmarks-view")).toBeInTheDocument();
  });
});
