// @vitest-environment node
// WI-UI1.4 — the per-theme bold repaint flag reaches the xterm options.
import { describe, it, expect } from "vitest";
import { buildTerminalOptions, clampScrollback, clampContrastRatio } from "./terminalOptions";

const base = {
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: "block" as const,
  cursorBlink: true,
  useWebGL: false,
  macOptionIsMeta: true,
  screenReaderMode: false,
  minimumContrastRatio: 4.5,
  scrollback: 5000,
  osc52Clipboard: false,
};

describe("drawBoldTextInBrightColors threading (WI-UI1.4/D10)", () => {
  it("is false for solarized (bright slots are text tiers) and true for paper", () => {
    expect(buildTerminalOptions({ ...base, themeId: "solarized" }, "mono").drawBoldTextInBrightColors).toBe(false);
    expect(buildTerminalOptions({ ...base, themeId: "paper" }, "mono").drawBoldTextInBrightColors).toBe(true);
  });
});

describe("clamps (pre-existing rules, pinned here since the file gained a test)", () => {
  it("scrollback: finite, truncated, bounded", () => {
    expect(clampScrollback(Number.NaN)).toBe(5000);
    expect(clampScrollback(50)).toBe(100);
    expect(clampScrollback(1_000_000)).toBe(200_000);
    expect(clampScrollback(1234.9)).toBe(1234);
  });
  it("contrast ratio: finite fallback 4.5, bounded 1..21", () => {
    expect(clampContrastRatio(Number.NaN)).toBe(4.5);
    expect(clampContrastRatio(0)).toBe(1);
    expect(clampContrastRatio(50)).toBe(21);
  });
});
