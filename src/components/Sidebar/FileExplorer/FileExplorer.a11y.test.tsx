// RW-15 (L11) — a11y landmark + axe coverage
//
// FileExplorer must expose a `navigation` landmark with an accessible name and
// pass axe with no violations. Exercised via the no-workspace empty state so
// the test stays free of the react-arborist Tree + Tauri FS stack.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { axe } from "vitest-axe";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import { FileExplorer } from "./FileExplorer";

const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

describe("FileExplorer — navigation landmark (RW-15 / L11)", () => {
  beforeEach(() => {
    // No workspace → renders the empty-state branch (nav landmark, no Tree).
    useWorkspaceStore.setState({ isWorkspaceMode: false, rootPath: null });
  });

  it("exposes a navigation landmark with an accessible name", () => {
    render(<FileExplorer currentFilePath={null} />);
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAccessibleName("File explorer");
  });

  it("has no axe violations", async () => {
    const { container } = render(<FileExplorer currentFilePath={null} />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
