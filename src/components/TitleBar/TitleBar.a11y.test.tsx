// RW-15 (L11) — a11y landmark + axe coverage
//
// TitleBar must expose a single `banner` landmark with an accessible name in
// both the filename-hidden and filename-shown configurations, and must pass
// axe with no violations.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";

const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

const mocks = vi.hoisted(() => ({ showFilename: false }));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentFilePath: () => "/tmp/notes.md",
  useDocumentIsDirty: () => false,
  useDocumentIsMissing: () => false,
  useActiveTabId: () => "tab-1",
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: () => "notes",
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => mocks.showFilename,
}));

vi.mock("./useTitleBarRename", () => ({
  useTitleBarRename: () => ({ renameFile: vi.fn(), isRenaming: false }),
}));

import { TitleBar } from "./TitleBar";

describe("TitleBar — banner landmark (RW-15 / L11)", () => {
  beforeEach(() => {
    mocks.showFilename = false;
  });

  it("exposes a banner landmark with an accessible name when filename is hidden", () => {
    render(<TitleBar />);
    const banner = screen.getByRole("banner");
    expect(banner).toHaveAccessibleName("Application title bar");
  });

  it("exposes a banner landmark with an accessible name when filename is shown", () => {
    mocks.showFilename = true;
    render(<TitleBar />);
    const banner = screen.getByRole("banner");
    expect(banner).toHaveAccessibleName("Application title bar");
    expect(banner).toHaveTextContent("notes");
  });

  it("has no axe violations (filename shown)", async () => {
    mocks.showFilename = true;
    const { container } = render(<TitleBar />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });

  it("renders browser navigation in the draggable title-bar shell", () => {
    render(<TitleBar browserChrome={<div data-testid="browser-navigation" />} />);

    const titleBar = screen.getByRole("banner");
    expect(titleBar).toHaveClass("title-bar--browser");
    expect(titleBar).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByTestId("browser-navigation")).toBeInTheDocument();
    expect(screen.queryByText("notes")).not.toBeInTheDocument();
  });

  it("abandons an in-progress rename when browser chrome takes over", () => {
    mocks.showFilename = true;
    const { rerender } = render(<TitleBar />);

    // Enter rename mode on the document title bar.
    fireEvent.doubleClick(screen.getByText("notes"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Browser workspace becomes active on the same instance.
    rerender(<TitleBar browserChrome={<div data-testid="browser-navigation" />} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // Returning to a document must NOT resurrect the stale rename input.
    rerender(<TitleBar />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
  });
});
