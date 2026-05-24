/**
 * applyTheme tests — ADR-014.
 */

import { describe, it, expect } from "vitest";
import { lightTheme, darkTheme, tokensToCssEntries, applyTheme } from "./index";

describe("tokensToCssEntries", () => {
  it("emits CSS var names for top-level scalars", () => {
    const entries = tokensToCssEntries(lightTheme);
    const map = new Map(entries);
    expect(map.get("--color-bg-primary")).toBe(lightTheme.color.bg.primary);
    expect(map.get("--color-text-primary")).toBe(lightTheme.color.text.primary);
    expect(map.get("--radius-sm")).toBe(lightTheme.radius.sm);
  });

  it("handles numeric record keys (space scale)", () => {
    const entries = tokensToCssEntries(lightTheme);
    const map = new Map(entries);
    expect(map.get("--space-1")).toBe(lightTheme.space[1]);
    expect(map.get("--space-10")).toBe(lightTheme.space[10]);
  });

  it("emits camelCase keys as kebab-case CSS var names", () => {
    const entries = tokensToCssEntries(lightTheme);
    const map = new Map(entries);
    expect(map.get("--color-semantic-error-bg")).toBe(lightTheme.color.semantic.errorBg);
    expect(map.get("--color-semantic-error-hover")).toBe(lightTheme.color.semantic.errorHover);
  });
});

describe("applyTheme", () => {
  it("writes CSS vars to the target element", () => {
    const target = document.createElement("div");
    applyTheme(lightTheme, target);
    expect(target.style.getPropertyValue("--color-bg-primary")).toBe(lightTheme.color.bg.primary);
    expect(target.style.getPropertyValue("--radius-sm")).toBe(lightTheme.radius.sm);
  });

  it("dark theme overrides light values", () => {
    const target = document.createElement("div");
    applyTheme(lightTheme, target);
    expect(target.style.getPropertyValue("--color-bg-primary")).toBe(lightTheme.color.bg.primary);
    applyTheme(darkTheme, target);
    expect(target.style.getPropertyValue("--color-bg-primary")).toBe(darkTheme.color.bg.primary);
    expect(darkTheme.color.bg.primary).not.toBe(lightTheme.color.bg.primary);
  });
});
