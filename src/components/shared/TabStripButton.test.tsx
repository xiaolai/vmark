// WI-UI2.3 — one add/close button for the three tab strips (document,
// browser pages, terminal): one glyph policy (Plus 14 / X 12), one class recipe.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabStripButton } from "./TabStripButton";

describe("TabStripButton", () => {
  it("add renders the canonical 24px square with a 14px Plus", () => {
    render(<TabStripButton kind="add" label="New tab" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "New tab" });
    expect(btn.className).toContain("vm-icon-btn");
    expect(btn.className).toContain("vm-icon-btn--sm");
    expect(btn.querySelector("svg")?.getAttribute("width")).toBe("14");
  });

  it("close renders the strip-close paint class with a 12px X", () => {
    render(<TabStripButton kind="close" label="Close tab" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Close tab" });
    expect(btn.className).toContain("tab-strip-close");
    expect(btn.querySelector("svg")?.getAttribute("width")).toBe("12");
  });

  it("keeps caller classes and forwards button props", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TabStripButton kind="close" label="Close" className="tab-close" data-tab-close onClick={onClick} />,
    );
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn.className).toContain("tab-close");
    expect(btn).toHaveAttribute("data-tab-close");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is always type=button — a strip inside a form must not submit it", () => {
    render(<TabStripButton kind="add" label="New" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "New" })).toHaveAttribute("type", "button");
  });
});
