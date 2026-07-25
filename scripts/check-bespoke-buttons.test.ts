/**
 * Tests for the bespoke-button budget gate.
 *
 * The detection is the whole gate: one that quietly matched nothing would pass
 * forever while the sprawl grew. These prove it counts real definitions, skips
 * the canonical classes, and does not fire on incidental mentions.
 */
import { describe, it, expect } from "vitest";
import { collectBespokeButtons } from "./check-bespoke-buttons.mjs";

/** Run the collector over in-memory CSS instead of the filesystem. */
function collect(sources: Record<string, string>) {
  return collectBespokeButtons(Object.keys(sources), (p) => sources[p]);
}

describe("collectBespokeButtons", () => {
  it("counts a hand-rolled button class", () => {
    const found = collect({ "a.css": ".kb-panel__btn {\n  color: red;\n}" });
    expect([...found.keys()]).toEqual([".kb-panel__btn"]);
  });

  it("skips the canonical classes", () => {
    const found = collect({
      "a.css": [
        ".vm-btn { color: red; }",
        ".vm-btn--primary { color: red; }",
        ".popup-icon-btn { color: red; }",
        ".popup-icon-btn--danger { color: red; }",
        ".universal-toolbar-btn { color: red; }",
      ].join("\n"),
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("counts a class once even with several rules (base, hover, focus)", () => {
    const found = collect({
      "a.css": [
        ".foo-btn { color: red; }",
        ".foo-btn:hover { color: blue; }",
        ".foo-btn:focus-visible { outline: none; }",
      ].join("\n"),
    });
    expect([...found.keys()]).toEqual([".foo-btn"]);
  });

  it("matches both -btn and -button naming", () => {
    const found = collect({ "a.css": ".a-btn { color: red; }\n.b-button { color: red; }" });
    expect([...found.keys()].sort()).toEqual([".a-btn", ".b-button"]);
  });

  it("records which file defines each class, for actionable output", () => {
    const found = collect({ "x/y.css": ".zed-btn { color: red; }" });
    expect(found.get(".zed-btn")).toBe("x/y.css");
  });

  it("does not count a button class merely referenced in a comment", () => {
    const found = collect({ "a.css": "/* see .legacy-btn for the old style */\n.vm-btn { color: red; }" });
    expect([...found.keys()]).toEqual([]);
  });

  it("catches a NEW bespoke class — the regression the gate exists to prevent", () => {
    const before = collect({ "a.css": ".vm-btn { color: red; }" });
    const after = collect({ "a.css": ".vm-btn { color: red; }\n.brand-new-btn { color: red; }" });
    expect(after.size).toBeGreaterThan(before.size);
    expect([...after.keys()]).toContain(".brand-new-btn");
  });
});
