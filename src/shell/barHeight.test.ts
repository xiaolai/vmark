// WI-UI3.5 (R11) — the 40px bar height has ONE owner: shellChrome.BAR_HEIGHT.
// index.css's --bar-height static and every layout constant derive from it;
// this test fails on divergence.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BAR_HEIGHT, shellChromeVars } from "./shellChrome";
import { CHROME_HEIGHT } from "./AppShell";

describe("bar height ownership (R11)", () => {
  it("the CSS static equals the TS constant", () => {
    const css = readFileSync("src/styles/index.css", "utf8");
    const m = /--bar-height:\s*(\d+)px/.exec(css);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(BAR_HEIGHT);
  });

  it("shellChromeVars publishes --bar-height", () => {
    expect(shellChromeVars(true)["--bar-height"]).toBe(`${BAR_HEIGHT}px`);
    expect(shellChromeVars(false)["--bar-height"]).toBe(`${BAR_HEIGHT}px`);
  });

  it("the chrome strip is one bar tall — a divergence is a design decision, not drift", () => {
    expect(CHROME_HEIGHT).toBe(BAR_HEIGHT);
  });
});
