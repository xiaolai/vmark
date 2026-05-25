/**
 * Tests for LintBadge component.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mocks — must be before imports that use them
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: (selector: (state: { activeTabId: Record<string, string | null> }) => unknown) =>
    selector({ activeTabId: { main: "tab-1" } }),
}));

const mockSelectNext = vi.fn();
const mockDiagnostics = { diagnosticsByTab: {} as Record<string, unknown[]> };

vi.mock("@/stores/documentStore", () => ({
  useLintStore: Object.assign(
    (selector: (state: typeof mockDiagnostics) => unknown) =>
      selector(mockDiagnostics),
    {
      getState: () => ({ selectNext: mockSelectNext }),
    },
  ),
}));

import { LintBadge } from "./LintBadge";

beforeEach(() => {
  vi.clearAllMocks();
  mockDiagnostics.diagnosticsByTab = {};
  mockSelectNext.mockReset();
});

describe("LintBadge", () => {
  it("renders nothing when no diagnostics", () => {
    mockDiagnostics.diagnosticsByTab = { "tab-1": [] };
    const { container } = render(<LintBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when diagnosticsByTab has no entry for active tab", () => {
    mockDiagnostics.diagnosticsByTab = {};
    const { container } = render(<LintBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders count badge with warning class when only warnings", () => {
    mockDiagnostics.diagnosticsByTab = {
      "tab-1": [
        { id: "W01-1-1", severity: "warning", messageKey: "lint.W01", ruleId: "W01",
          messageParams: {}, line: 1, column: 1, offset: 0, uiHint: "exact" },
      ],
    };
    render(<LintBadge />);
    const badge = screen.getByRole("button");
    expect(badge).toHaveClass("lint-badge--warning");
    expect(badge).not.toHaveClass("lint-badge--error");
    expect(badge.textContent).toContain("1");
  });

  it("renders count badge with error class when any errors", () => {
    mockDiagnostics.diagnosticsByTab = {
      "tab-1": [
        { id: "E01-1-1", severity: "error", messageKey: "lint.E01", ruleId: "E01",
          messageParams: {}, line: 1, column: 1, offset: 0, uiHint: "exact" },
        { id: "W01-2-1", severity: "warning", messageKey: "lint.W01", ruleId: "W01",
          messageParams: {}, line: 2, column: 1, offset: 10, uiHint: "exact" },
      ],
    };
    render(<LintBadge />);
    const badge = screen.getByRole("button");
    expect(badge).toHaveClass("lint-badge--error");
  });

  it("shows correct count", () => {
    mockDiagnostics.diagnosticsByTab = {
      "tab-1": [
        { id: "W01-1-1", severity: "warning", messageKey: "lint.W01", ruleId: "W01",
          messageParams: {}, line: 1, column: 1, offset: 0, uiHint: "exact" },
        { id: "W02-2-1", severity: "warning", messageKey: "lint.W02", ruleId: "W02",
          messageParams: {}, line: 2, column: 1, offset: 10, uiHint: "exact" },
        { id: "W03-3-1", severity: "warning", messageKey: "lint.W03", ruleId: "W03",
          messageParams: {}, line: 3, column: 1, offset: 20, uiHint: "exact" },
      ],
    };
    render(<LintBadge />);
    const badge = screen.getByRole("button");
    expect(badge.textContent).toContain("3");
  });

  it("calls selectNext on click", async () => {
    const user = userEvent.setup();
    mockDiagnostics.diagnosticsByTab = {
      "tab-1": [
        { id: "W01-1-1", severity: "warning", messageKey: "lint.W01", ruleId: "W01",
          messageParams: {}, line: 1, column: 1, offset: 0, uiHint: "exact" },
      ],
    };
    render(<LintBadge />);
    const badge = screen.getByRole("button");
    await user.click(badge);
    expect(mockSelectNext).toHaveBeenCalledWith("tab-1");
  });
});
