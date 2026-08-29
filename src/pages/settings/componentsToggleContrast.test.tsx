// WI-UI1.6/D8 — Toggle contrast, measured from the theme catalog.
// Split out of components.test.tsx (300-line gate freezes that file's size).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toggle } from "./components";

// WI-UI1.6 — the Toggle's OFF state must be FINDABLE: the track boundary is
// --control-border, which D8 authored to ≥ 3:1 on every theme's page. This
// resolves the CLASS to the token and computes the real ratio from the
// catalog — replacing the old "className contains var(--contrast-text)"
// wiring assertion with a measurement.
import { themes as themeCatalog } from "@/theme/themes";

describe("Toggle contrast (WI-UI1.6/D8)", () => {
  const lum = (hexColor: string) => {
    const n = parseInt(hexColor.slice(1), 16);
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const ratio = (a: string, b: string) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it("the track is the canonical .vm-switch (its --control-border boundary lives in panel-shared.css)", () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch").classList.contains("vm-switch")).toBe(true);
    const css = readFileSync("src/styles/panel-shared.css", "utf8");
    const track = css.slice(css.indexOf(".vm-switch {"), css.indexOf("}", css.indexOf(".vm-switch {")));
    expect(track).toContain("var(--control-border)");
  });

  it("controlBorder clears 3:1 against the page on all six themes", () => {
    for (const [id, t] of Object.entries(themeCatalog)) {
      expect(ratio(t.color.controlBorder, t.color.bg.primary), id).toBeGreaterThanOrEqual(3);
    }
  });

  it("the ON knob is the page colour — dark ink on dark themes, not a fixed white", () => {
    render(<Toggle checked={true} onChange={vi.fn()} />);
    const knob = screen.getByRole("switch").querySelector("span");
    expect(knob?.classList.contains("vm-switch__knob")).toBe(true);
    const css = readFileSync("src/styles/panel-shared.css", "utf8");
    const knobRule = css.slice(css.indexOf(".vm-switch__knob {"), css.indexOf("}", css.indexOf(".vm-switch__knob {")));
    expect(knobRule).toContain("background: var(--bg-color)");
    expect(knobRule).not.toContain("contrast-text");
  });
});
