// WI-UI1.6/D8 — Toggle contrast, measured from the theme catalog.
// Split out of components.test.tsx (300-line gate freezes that file's size).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toggle } from "./components";

// WI-UI1.6 authored the OFF track's findability as a --control-border ring;
// the maintainer superseded that on 2026-09-02: the track is BORDERLESS and
// the off state is the hover-strong fill, with the page-colour knob carrying
// the shape contrast. The measurement below moves with the decision — it now
// computes the knob-vs-track ratio from the catalog, since the knob-on-fill
// pair is what makes the off switch findable without a ring.
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

  it("the track is the canonical .vm-switch, borderless on the hover-strong fill (maintainer 2026-09-02)", () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole("switch").classList.contains("vm-switch")).toBe(true);
    const css = readFileSync("src/styles/panel-shared.css", "utf8");
    const track = css.slice(css.indexOf(".vm-switch {"), css.indexOf("}", css.indexOf(".vm-switch {")));
    expect(track).toContain("border: none");
    expect(track).toContain("var(--hover-bg-strong)");
    expect(track).not.toContain("var(--control-border)");
  });

  it("the page-colour knob is SEPARATED from the OFF track fill on every theme (C1f's 1.15 surface-ramp floor)", () => {
    // The ring — and its 3:1 — are gone by maintainer decision; what remains
    // measurable is that the knob-on-fill pair is a real surface step:
    // hover.strong composited over bg.primary, against the bg.primary knob,
    // held to the same 1.15 floor C1f applies to the bg.secondary ramp.
    const compose = (rgba: string, hex: string) => {
      const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/.exec(rgba);
      if (!m) throw new Error(`unexpected tint format: ${rgba}`);
      const a = Number(m[4]);
      const n = parseInt(hex.slice(1), 16);
      const bg = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const fg = [Number(m[1]), Number(m[2]), Number(m[3])];
      const out = bg.map((b, i) => Math.round(fg[i]! * a + b * (1 - a)));
      return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };
    for (const [id, t] of Object.entries(themeCatalog)) {
      const track = compose(t.color.hover.strong, t.color.bg.primary);
      expect(ratio(t.color.bg.primary, track), id).toBeGreaterThanOrEqual(1.15);
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
