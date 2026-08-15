// WI-DS2.1 — the control-triple diff: measure which token a button picked, not
// merely that it picked one. See dev-docs/plans/20260815-design-system-remediation.md.
import { describe, expect, it } from "vitest";
import {
  buildTokenMap,
  canonicalTriple,
  collectBespokeButtons,
  collectShapeDrift,
  ratchetVerdict,
  resolveValue,
} from "./check-bespoke-buttons.mjs";

const BUTTON_SHARED = `
.vm-btn {
  display: inline-flex;
  padding: var(--space-1-5) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}
.vm-btn--primary { color: var(--primary-color); }
`;

const TOKENS = `
:root {
  --space-1-5: 6px;
  --space-2: 8px;
  --space-3: 12px;
  --space-3-5: 14px;
  --space-4: 16px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --font-size-sm: 12px;
  --font-size-md: 14px;
  --font-size-base: 13px;
}
`;

/** A reader over an in-memory {path: contents} map. */
const reader = (files) => (p) => {
  if (!(p in files)) throw new Error(`unexpected read: ${p}`);
  return files[p];
};

function drift(files, { tsx = ["a.tsx"], css = ["a.css"] } = {}) {
  const read = reader(files);
  const tokens = buildTokenMap(TOKENS);
  const canonical = canonicalTriple(BUTTON_SHARED);
  return collectShapeDrift(tsx, css, { canonical, tokens }, read);
}

describe("canonicalTriple", () => {
  it("reads the three shape properties off .vm-btn", () => {
    expect(canonicalTriple(BUTTON_SHARED)).toEqual({
      padding: "var(--space-1-5) var(--space-3)",
      "border-radius": "var(--radius-sm)",
      "font-size": "var(--font-size-sm)",
    });
  });

  // The real `.vm-btn` carries a comment directly above `padding`. Before
  // comments were stripped this threw on the shipped stylesheet.
  it("sees a declaration that follows a comment", () => {
    const css = `.vm-btn {
      /* 6px 12px — the semantic scale has no 6px step. */
      padding: var(--space-1-5) var(--space-3);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
    }`;
    expect(canonicalTriple(css).padding).toBe("var(--space-1-5) var(--space-3)");
  });

  it("fails closed when .vm-btn is missing entirely", () => {
    expect(() => canonicalTriple(".other { padding: 1px; }")).toThrow(/\.vm-btn/);
  });

  it("fails closed when .vm-btn stops declaring one of the three", () => {
    expect(() => canonicalTriple(".vm-btn { padding: 1px; border-radius: 2px; }")).toThrow(
      /font-size/,
    );
  });
});

describe("resolveValue", () => {
  const tokens = buildTokenMap(TOKENS);

  it("resolves a single var() to its literal", () => {
    expect(resolveValue("var(--radius-sm)", tokens)).toBe("4px");
  });

  it("resolves every var() in a multi-value declaration", () => {
    expect(resolveValue("var(--space-1-5) var(--space-3)", tokens)).toBe("6px 12px");
  });

  it("treats a literal spelling as equal to its token spelling", () => {
    expect(resolveValue("6px 12px", tokens)).toBe(resolveValue("var(--space-1-5) var(--space-3)", tokens));
  });

  it("leaves an unknown token alone rather than inventing a value", () => {
    expect(resolveValue("var(--nope)", tokens)).toBe("var(--nope)");
  });
});

// Audit 20260815-163607 #12. The NAME collector anchors at line start, so only
// the first class of a descendant selector was ever seen.
describe("collectBespokeButtons — every class in the selector", () => {
  it("sees a button class that is not the first in its selector", () => {
    const found = collectBespokeButtons(["a.css"], () => `.tiptap-editor .code-copy-btn { padding: 1px; }`);
    expect([...found.keys()]).toEqual([".code-copy-btn"]);
  });

  it("sees every button class in a comma-separated selector list", () => {
    const found = collectBespokeButtons(
      ["a.css"],
      () => `.a-btn,\n.wrapper .b-btn { padding: 1px; }`,
    );
    expect([...found.keys()].sort()).toEqual([".a-btn", ".b-btn"]);
  });

  it("still excludes the canonical classes wherever they appear", () => {
    const found = collectBespokeButtons(["a.css"], () => `.panel .vm-btn--cta { padding: 1px; }`);
    expect([...found.keys()]).toEqual([]);
  });

  it("does not count a button class named only inside a comment", () => {
    const found = collectBespokeButtons(["a.css"], () => `/* use .ghost-btn here */\n.real-btn { padding: 1px; }`);
    expect([...found.keys()]).toEqual([".real-btn"]);
  });
});

// Audit 20260815-163607 #8/#9. The CLI repeated this ratchet three times, once
// per budget, and none of the branches were covered.
describe("ratchetVerdict", () => {
  const base = { key: "maxThings", noun: "things" };

  it("holds when the count equals the budget", () => {
    expect(ratchetVerdict({ ...base, limit: 5, actual: 5 })).toBeNull();
  });

  it("fails OVER budget and refuses to suggest raising it", () => {
    const v = ratchetVerdict({ ...base, limit: 5, actual: 6 });
    expect(v.kind).toBe("over");
    expect(v.message).toMatch(/6 things, budget is 5/);
    expect(v.message).toMatch(/Do NOT raise the budget/);
  });

  it("fails STALE below budget and names the number to write", () => {
    const v = ratchetVerdict({ ...base, limit: 5, actual: 3 });
    expect(v.kind).toBe("stale");
    expect(v.message).toMatch(/Lower `maxThings` to 3/);
  });

  // Fail closed: a missing or corrupted budget must not read as "held".
  it.each([undefined, null, "5", 5.5, NaN])("rejects a non-integer budget (%s)", (limit) => {
    const v = ratchetVerdict({ ...base, limit, actual: 5 });
    expect(v.kind).toBe("invalid");
    expect(v.message).toMatch(/needs an integer `maxThings`/);
  });

  it("includes the caller's detail in the over-budget message only", () => {
    const detail = "  .some-btn  (a.css)";
    expect(ratchetVerdict({ ...base, limit: 1, actual: 2, overDetail: detail }).message).toContain(detail);
    expect(ratchetVerdict({ ...base, limit: 3, actual: 2, overDetail: detail }).message).not.toContain(detail);
  });
});

describe("collectShapeDrift", () => {
  it("flags a class whose radius and font-size diverge from canonical", () => {
    const found = drift({
      "a.tsx": `<button className="thing__btn">x</button>`,
      "a.css": `.thing__btn {
        padding: var(--space-1-5) var(--space-3);
        border-radius: var(--radius-md);
        font-size: var(--font-size-md);
      }`,
    });
    expect([...found.keys()]).toEqual(["thing__btn"]);
    const props = found.get("thing__btn").diffs.map((d) => d.property).sort();
    expect(props).toEqual(["border-radius", "font-size"]);
  });

  it("does not flag a class that matches canonical, however it is spelled", () => {
    const found = drift({
      "a.tsx": `<button className="literal__btn">x</button>`,
      // Same shape, written as literals rather than tokens.
      "a.css": `.literal__btn { padding: 6px 12px; border-radius: 4px; font-size: 12px; }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("ignores properties the class never declares", () => {
    const found = drift({
      "a.tsx": `<button className="tint__btn">x</button>`,
      "a.css": `.tint__btn { color: red; }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("ignores the canonical classes themselves", () => {
    const found = drift({
      "a.tsx": `<button className="vm-btn vm-btn--cta">x</button>`,
      "a.css": `.vm-btn--cta { padding: var(--space-2) var(--space-4); }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("ignores a class that is never applied to a button", () => {
    const found = drift({
      "a.tsx": `<div className="panel__btn">x</div>`,
      "a.css": `.panel__btn { border-radius: var(--radius-md); }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("honours an exemption marker that states a reason", () => {
    const found = drift({
      "a.tsx": `<button className="wide__btn">x</button>`,
      "a.css": `.wide__btn {
        /* button-shape-ok: touch target, coarse pointer needs 44px minimum */
        border-radius: var(--radius-md);
      }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  // Audit 20260815-163607 #1. `\S` matched the `*` of the closing `*/`, so a
  // marker with a colon and NOTHING after it counted as a stated reason — the
  // exact mute-button the required-reason rule exists to prevent.
  it("rejects an exemption whose reason is empty after the colon", () => {
    for (const marker of [
      "/* button-shape-ok: */",
      "/* button-shape-ok:*/",
      "/* button-shape-ok:    */",
    ]) {
      const found = drift({
        "a.tsx": `<button className="hollow__btn">x</button>`,
        "a.css": `.hollow__btn { ${marker} border-radius: var(--radius-md); }`,
      });
      expect([...found.keys()], `marker ${marker} must not exempt`).toEqual(["hollow__btn"]);
    }
  });

  // Audit 20260815-163607 #2. Comments are folded into the selector capture, so
  // a colon anywhere in a preceding comment made the base rule invisible. This
  // repo writes `/* focus: caret-only … */` above real rules, so the gate was
  // silently under-reporting.
  it("still reads a base rule preceded by a comment containing a colon", () => {
    const found = drift({
      "a.tsx": `<button className="noted__btn">x</button>`,
      "a.css": `/* focus: caret-only — the caret is the indicator (rule 33 §2). */
        .noted__btn { border-radius: var(--radius-md); }`,
    });
    expect([...found.keys()]).toEqual(["noted__btn"]);
  });

  it("rejects a bare exemption marker with no reason", () => {
    const found = drift({
      "a.tsx": `<button className="lazy__btn">x</button>`,
      "a.css": `.lazy__btn {
        /* button-shape-ok */
        border-radius: var(--radius-md);
      }`,
    });
    expect([...found.keys()]).toEqual(["lazy__btn"]);
  });

  it("reads the base rule only — a focus ring's radius is not the button's shape", () => {
    const found = drift({
      "a.tsx": `<button className="ring__btn">x</button>`,
      "a.css": `.ring__btn { border-radius: var(--radius-sm); }
        .ring__btn:focus-visible::after { border-radius: var(--radius-md); }
        .ring__btn:hover { font-size: var(--font-size-md); }`,
    });
    expect([...found.keys()]).toEqual([]);
  });

  it("reports the AUTHORED text, not the resolved value, so the fix is obvious", () => {
    const found = drift({
      "a.tsx": `<button className="thing__btn">x</button>`,
      "a.css": `.thing__btn { border-radius: var(--radius-md); }`,
    });
    const [d] = found.get("thing__btn").diffs;
    expect(d.actual).toBe("var(--radius-md)");
    expect(d.expected).toBe("var(--radius-sm)");
  });
});
