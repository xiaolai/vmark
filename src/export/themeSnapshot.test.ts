import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { captureThemeCSS, isDarkTheme } from "./themeSnapshot";

describe("captureThemeCSS", () => {
  let originalCssText: string;
  beforeEach(() => {
    originalCssText = document.documentElement.style.cssText;
  });
  afterEach(() => {
    document.documentElement.style.cssText = originalCssText;
  });

  it("returns a :root block", () => {
    const css = captureThemeCSS();
    expect(css.startsWith(":root {")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
  });

  it("emits set CSS variables with their values", () => {
    document.documentElement.style.setProperty("--bg-color", "#fafafa");
    document.documentElement.style.setProperty("--text-color", "#222222");
    const css = captureThemeCSS();
    expect(css).toMatch(/--bg-color:\s*#fafafa;/);
    expect(css).toMatch(/--text-color:\s*#222222;/);
  });

  it("skips unset CSS variables (no empty value lines)", () => {
    const css = captureThemeCSS();
    expect(css).not.toMatch(/: ;/);
    expect(css).not.toMatch(/:\s*;/);
  });
});

describe("isDarkTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark-theme", "dark");
  });

  it("returns false when no theme class is present", () => {
    expect(isDarkTheme()).toBe(false);
  });

  it("returns true when .dark-theme is set", () => {
    document.documentElement.classList.add("dark-theme");
    expect(isDarkTheme()).toBe(true);
  });

  it("returns true when .dark (Tailwind) is set", () => {
    document.documentElement.classList.add("dark");
    expect(isDarkTheme()).toBe(true);
  });
});
