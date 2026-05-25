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
import { Sidebar } from "./Sidebar";

// FileExplorer pulls in the workspace stack (Tauri FS, watchers, etc.) which
// is irrelevant to these assertions. Stub it to a static node so the test
// stays focused on the Sidebar shell wiring.
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
