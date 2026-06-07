// RW-15 (L11) — a11y landmark + axe coverage
//
// TitleBar must expose a single `banner` landmark with an accessible name in
// both the filename-hidden and filename-shown configurations, and must pass
// axe with no violations.

import { render, screen } from "@testing-library/react";
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
});
