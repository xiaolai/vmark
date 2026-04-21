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

vi.mock("@/utils/settingsWindow", () => ({
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

describe("StatusBar accessibility", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarVisible: false, statusBarVisible: true });
  });

  it("exposes aria-expanded=false on the sidebar-toggle button when the sidebar is collapsed", () => {
    render(<StatusBar />);
    const toggle = screen.getByLabelText(/open sidebar/i);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
