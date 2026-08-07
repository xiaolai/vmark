// RW-15 (L11) — a11y landmark + axe coverage
//
// Verifies the application's ARIA landmark structure when AppShell composes
// its slots: exactly one main, one banner, one contentinfo, a navigation, and
// distinguishable complementary regions — and that the composed tree passes
// axe with no violations. AppShell stays a pure layout primitive (ADR-007);
// here we feed it role-bearing stub slots that mirror the real landmark roles
// the feature components assert in their own a11y tests.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
// Registers `toHaveNoViolations`. Opt-in: axe-core is too heavy for the
// global setup, which every app-tier test file loads. See src/test/axeMatchers.
import "@/test/axeMatchers";
import { axe } from "vitest-axe";
import { AppShell } from "./AppShell";
import { EditorArea } from "./EditorArea";

// jsdom can't compute layout, so color-contrast is unreliable here; disable
// that one rule (standard practice for jsdom + axe) and keep the rest.
const AXE_OPTS = { rules: { "color-contrast": { enabled: false } } };

function renderShell() {
  return render(
    <AppShell
      chrome={
        <div role="banner" aria-label="Application title bar">
          <span>doc.md</span>
        </div>
      }
      sidebar={
        <>
          <div role="navigation" aria-label="File explorer">
            <a href="#a">file-a.md</a>
          </div>
          <div role="complementary" aria-label="Document outline">
            <a href="#h1">Heading</a>
          </div>
        </>
      }
      sidebarWidth={260}
      primary={
        <EditorArea
          editor={
            <div>
              <h1>Title</h1>
              <p>body</p>
            </div>
          }
          bottomBar={<div role="contentinfo" aria-label="Status bar">ready</div>}
          panelPosition="right"
        />
      }
    />
  );
}

describe("AppShell — landmark structure (RW-15 / L11)", () => {
  it("exposes exactly one main landmark", () => {
    renderShell();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("exposes exactly one banner landmark", () => {
    renderShell();
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it("exposes a navigation landmark with an accessible name", () => {
    renderShell();
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAccessibleName("File explorer");
  });

  it("distinguishes multiple complementary landmarks by accessible name", () => {
    renderShell();
    // This assertion used to read raw `aria-label` attributes into an array and
    // check only that the set had no duplicates. `[null, "Document outline"]`
    // satisfied both halves — so deleting AppShell's OWN accessible name, the
    // one production regression this test exists to catch, left it green.
    // `null` is not a duplicate of anything.
    //
    // Now: every complementary must HAVE a name, and each expected landmark is
    // queried by that name, so a missing or renamed one fails by absence.
    const regions = screen.getAllByRole("complementary");
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const region of regions) {
      expect(region).toHaveAccessibleName(expect.stringMatching(/\S/));
    }

    // Queried by name, not filtered from a list: `getByRole` throws when the
    // named landmark is absent, and throws when it is ambiguous.
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Document outline" }),
    ).toBeInTheDocument();

    // Still no duplicate-landmark ambiguity — but computed over accessible
    // names that are now guaranteed non-empty.
    const names = regions.map((el) => el.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes a contentinfo landmark", () => {
    renderShell();
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("has no axe violations in the composed landmark tree", async () => {
    const { container } = renderShell();
    const results = await axe(container, AXE_OPTS);
    expect(results).toHaveNoViolations();
  });
});
