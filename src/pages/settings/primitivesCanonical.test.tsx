// WI-UI2.4 — the Settings primitives are THIN WRAPPERS over the canonical
// controls: Button → .vm-btn, Select → .vm-select-field/.vm-select,
// CopyButton/CloseButton → .vm-icon-btn--sm. Split from components.test.tsx
// (its size is frozen by the file-size gate).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, CopyButton, CloseButton, Select } from "./components";

describe("Button wraps .vm-btn (WI-UI2.4)", () => {
  it.each([
    { variant: "secondary" as const, expected: ["vm-btn"], not: ["vm-btn--cta", "vm-btn--danger"] },
    { variant: "primary" as const, expected: ["vm-btn", "vm-btn--cta"], not: [] },
    { variant: "danger" as const, expected: ["vm-btn", "vm-btn--danger"], not: [] },
  ])("variant $variant carries $expected", ({ variant, expected, not }) => {
    render(<Button variant={variant}>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    for (const c of expected) expect(btn.classList.contains(c), c).toBe(true);
    for (const c of not) expect(btn.classList.contains(c), c).toBe(false);
  });

  it("size sm maps to the canonical compact variant, md to the base", () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Small" }).classList.contains("vm-btn--compact")).toBe(true);
    expect(screen.getByRole("button", { name: "Medium" }).classList.contains("vm-btn--compact")).toBe(false);
  });
});

describe("Select wraps .vm-select (WI-UI2.4)", () => {
  it("renders the vm-select-field wrapper around a .vm-select control", () => {
    render(
      <Select value="a" options={[{ value: "a", label: "A" }]} onChange={vi.fn()} aria-label="Pick" />,
    );
    const select = screen.getByRole("combobox", { name: "Pick" });
    expect(select.classList.contains("vm-select")).toBe(true);
    expect(select.parentElement?.classList.contains("vm-select-field")).toBe(true);
  });
});

describe("CopyButton / CloseButton wrap .vm-icon-btn--sm (WI-UI2.4)", () => {
  it("CopyButton is a canonical small icon square", () => {
    render(<CopyButton text="x" />);
    const btn = screen.getByRole("button");
    expect(btn.classList.contains("vm-icon-btn")).toBe(true);
    expect(btn.classList.contains("vm-icon-btn--sm")).toBe(true);
  });

  it("CloseButton is a canonical small icon square", () => {
    render(<CloseButton onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.classList.contains("vm-icon-btn")).toBe(true);
    expect(btn.classList.contains("vm-icon-btn--sm")).toBe(true);
  });
});
