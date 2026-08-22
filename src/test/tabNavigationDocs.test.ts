// @vitest-environment node
// WI-DSPL1.4 — the tab-navigation guide documents what shipped.
//
// A docs work item with no test is a docs work item that silently rots. The
// keybinding gate already pins the shortcuts TABLE in `shortcuts.md`; nothing
// pinned the prose guide, which is where a user actually learns that
// `Ctrl+Tab` is a toggle and that closing a paned tab keeps the survivor.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guide = () => readFileSync("website/guide/tab-navigation.md", "utf8");

describe("website/guide/tab-navigation.md", () => {
  it.each([
    ["the last-used chord", "Ctrl + Tab"],
    ["the split chord", "Alt + Mod + \\"],
    ["close pane", "Alt + Mod + Shift + \\"],
    ["focus other pane", "Alt + Mod + Shift + O"],
    ["the context-menu entry", "Open to the Side"],
    ["sync scroll", "Sync Pane Scroll"],
  ])("documents %s", (_label, needle) => {
    expect(guide()).toContain(needle);
  });

  it("explains that Last Used Tab is a toggle, not a positional cycle", () => {
    // The distinction from Next/Previous Tab is the whole point of the feature;
    // documenting only the chord would leave it looking redundant.
    const text = guide();
    expect(text).toMatch(/toggle, not a cycle/i);
    expect(text).toMatch(/Next \/ Previous Tab|Next and Previous Tab/);
  });

  it("explains that closing one pane keeps the survivor (D10/R2)", () => {
    expect(guide()).toMatch(/collapses onto the other/i);
  });
});
