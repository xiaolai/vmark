// RW-15 (L11) — a11y landmark + axe coverage
//
// OutlineView must expose a `complementary` landmark with an accessible name
// (distinct from the AppShell sidebar aside) and pass axe with no violations.
// Exercised via the no-headings branch so the test avoids the heading-tree
// build and remains a focused landmark check.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";

const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

// Empty document → no headings → the simplest complementary-landmark branch.
vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentContent: () => "",
}));

import { OutlineView } from "./OutlineView";

describe("OutlineView — complementary landmark (RW-15 / L11)", () => {
  it("exposes a complementary landmark with an accessible name", () => {
    render(<OutlineView />);
    const region = screen.getByRole("complementary");
    expect(region).toHaveAccessibleName("Document outline");
  });

  it("has no axe violations", async () => {
    const { container } = render(<OutlineView />);
    expect(await axe(container, AXE_OPTS)).toHaveNoViolations();
  });
});
