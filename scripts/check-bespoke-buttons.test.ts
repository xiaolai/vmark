/**
 * Tests for the bespoke-button budget gate.
 *
 * The detection is the whole gate: one that quietly matched nothing would pass
 * forever while the sprawl grew. These prove it counts real definitions, skips
 * the canonical classes, and does not fire on incidental mentions.
 */
import { describe, it, expect } from "vitest";
import { collectBespokeButtons, collectStyledButtonClasses } from "./check-bespoke-buttons.mjs";

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

/**
 * The name-based collector above can only see classes whose NAME contains
 * "btn" or "button". `.workspace-approval-approve` styled a real button and was
 * invisible to it — the budget read 88/88 while the drift it exists to catch
 * was happening. This second collector keys on USAGE instead: a class applied
 * to a <button> element whose CSS re-derives a button surface (padding plus a
 * border or background). Naming cannot evade it.
 */
function collectStyled(tsx: Record<string, string>, css: Record<string, string>) {
  const all = { ...tsx, ...css };
  return collectStyledButtonClasses(Object.keys(tsx), Object.keys(css), (p) => all[p]);
}

describe("collectStyledButtonClasses", () => {
  const BUTTONISH = "{ padding: 4px 8px; border: 1px solid red; }";

  it("catches a button class that the name regex cannot see", () => {
    const found = collectStyled(
      { "a.tsx": '<button className="workspace-approval-approve">ok</button>' },
      { "a.css": `.workspace-approval-approve ${BUTTONISH}` },
    );
    expect([...found.keys()]).toEqual(["workspace-approval-approve"]);
  });

  it("skips the canonical primitives", () => {
    const found = collectStyled(
      { "a.tsx": '<button className="vm-btn vm-btn--primary">ok</button>' },
      { "a.css": `.vm-btn ${BUTTONISH}\n.vm-btn--primary ${BUTTONISH}` },
    );
    expect([...found.keys()]).toEqual([]);
  });

  it("ignores classes that do not style a button surface", () => {
    // Layout-only and state classes are not re-derived buttons.
    const found = collectStyled(
      { "a.tsx": '<button className="is-active toolbar-slot">ok</button>' },
      { "a.css": ".is-active { color: red; }\n.toolbar-slot { display: flex; }" },
    );
    expect([...found.keys()]).toEqual([]);
  });

  it("ignores a styled class that is never applied to a button", () => {
    const found = collectStyled(
      { "a.tsx": '<div className="card-surface">x</div>' },
      { "a.css": `.card-surface ${BUTTONISH}` },
    );
    expect([...found.keys()]).toEqual([]);
  });

  it("reads classes out of a template literal className", () => {
    const found = collectStyled(
      { "a.tsx": '<button className={`genie-chip ${active ? "on" : ""}`}>x</button>' },
      { "a.css": `.genie-chip ${BUTTONISH}` },
    );
    expect([...found.keys()]).toEqual(["genie-chip"]);
  });

  it("counts a class once however many buttons use it", () => {
    const found = collectStyled(
      {
        "a.tsx": '<button className="row-action">a</button>',
        "b.tsx": '<button className="row-action">b</button>',
      },
      { "a.css": `.row-action ${BUTTONISH}` },
    );
    expect([...found.keys()]).toEqual(["row-action"]);
  });

  it("records where the class is used, for actionable output", () => {
    const found = collectStyled(
      { "x/y.tsx": '<button className="zed-action">x</button>' },
      { "a.css": `.zed-action ${BUTTONISH}` },
    );
    expect(found.get("zed-action")).toBe("x/y.tsx");
  });

  it("counts a background-only surface too (no border)", () => {
    const found = collectStyled(
      { "a.tsx": '<button className="pill-thing">x</button>' },
      { "a.css": ".pill-thing { padding: 2px 6px; background: blue; }" },
    );
    expect([...found.keys()]).toEqual(["pill-thing"]);
  });
});
