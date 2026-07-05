/**
 * Tests for the shared diagram theme-token reader.
 *
 * The helper reads the app's CSS custom properties from documentElement so
 * diagram renderers (Mermaid, Graphviz) derive their palettes from the active
 * theme — any theme, current or future — instead of a light/dark binary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readDiagramThemeTokens,
  serializeDiagramThemeTokens,
  isDarkColor,
} from "./diagramThemeTokens";

const TOKEN_NAMES = [
  "--bg-color",
  "--bg-secondary",
  "--text-color",
  "--text-secondary",
  "--border-color",
  "--accent-primary",
  "--md-char-color",
  "--font-mono",
];

function clearInlineTokens(): void {
  for (const name of TOKEN_NAMES) {
    document.documentElement.style.removeProperty(name);
  }
  document.documentElement.className = "";
}

beforeEach(clearInlineTokens);
afterEach(clearInlineTokens);

describe("readDiagramThemeTokens", () => {
  it("returns light fallbacks when no tokens are defined (test/SSR environments)", () => {
    const tokens = readDiagramThemeTokens();
    expect(tokens.bgColor).toBe("#eeeded");
    expect(tokens.bgSecondary).toBe("#e5e4e4");
    expect(tokens.textColor).toBe("#1a1a1a");
    expect(tokens.textSecondary).toBe("#666666");
    expect(tokens.borderColor).toBe("#d5d4d4");
    expect(tokens.accentPrimary).toBe("#0066cc");
    expect(tokens.mdCharColor).toBe("#777777");
    expect(tokens.fontMono).toContain("mono");
    expect(tokens.isDark).toBe(false);
  });

  it("reads tokens set on documentElement", () => {
    document.documentElement.style.setProperty("--bg-color", "#101418");
    document.documentElement.style.setProperty("--text-color", "#f0f0f0");
    document.documentElement.style.setProperty("--accent-primary", "#58a6ff");

    const tokens = readDiagramThemeTokens();
    expect(tokens.bgColor).toBe("#101418");
    expect(tokens.textColor).toBe("#f0f0f0");
    expect(tokens.accentPrimary).toBe("#58a6ff");
  });

  it("derives isDark from a dark background color even without a dark class", () => {
    document.documentElement.style.setProperty("--bg-color", "#101418");
    expect(readDiagramThemeTokens().isDark).toBe(true);
  });

  it("derives isDark from the .dark-theme class", () => {
    document.documentElement.classList.add("dark-theme");
    expect(readDiagramThemeTokens().isDark).toBe(true);
  });

  it("derives isDark from the .dark class", () => {
    document.documentElement.classList.add("dark");
    expect(readDiagramThemeTokens().isDark).toBe(true);
  });
});

describe("serializeDiagramThemeTokens", () => {
  it("produces a stable snapshot that changes when any token changes", () => {
    const before = serializeDiagramThemeTokens(readDiagramThemeTokens());
    expect(serializeDiagramThemeTokens(readDiagramThemeTokens())).toBe(before);

    document.documentElement.style.setProperty("--border-color", "#3a3f46");
    const after = serializeDiagramThemeTokens(readDiagramThemeTokens());
    expect(after).not.toBe(before);
  });
});

describe("isDarkColor", () => {
  it.each([
    ["#000000", true],
    ["#1f2937", true],
    ["#ffffff", false],
    ["#eeeded", false],
    ["#fff", false],
    ["#111", true],
    ["rgb(16, 20, 24)", true],
    ["rgb(238, 237, 237)", false],
    ["rgba(16, 20, 24, 0.9)", true],
  ])("classifies %s as dark=%s", (color, expected) => {
    expect(isDarkColor(color)).toBe(expected);
  });

  it("returns false for unparseable colors", () => {
    expect(isDarkColor("var(--nope)")).toBe(false);
    expect(isDarkColor("")).toBe(false);
    expect(isDarkColor("hotpink")).toBe(false);
  });
});
