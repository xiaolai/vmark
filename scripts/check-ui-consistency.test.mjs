// WI-UI0.3 — self-test for the ui-consistency gate (C3–C11).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { runChecks, compareBaseline } from "./check-ui-consistency.mjs";
import { focusPaintedClasses, uiOkMarkers } from "./lib/uiConsistencyCss.mjs";
import { growthExponent, measureGrowth } from "../src/test/cpuClock.ts";

const INDEX = `@theme inline { --text-sm: var(--font-size-base); --font-sans: var(--font-ui); --shadow-popup: var(--shadow-popup); }
:root { --z-resize-handle: 10; --z-bar: 100; --z-toolbar: 102; --z-context-menu: 1000; --z-popup: 9999; --icon-size-sm: 22px; --font-size-sm: 12px; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }`;

/** Run the gate over in-memory fixtures. */
function run(fixtures) {
  const cssFiles = Object.keys(fixtures).filter((f) => f.endsWith(".css"));
  const tsxFiles = Object.keys(fixtures).filter((f) => f.endsWith(".tsx"));
  return runChecks({
    cssFiles,
    tsxFiles,
    indexCssText: fixtures["src/styles/index.css"] ?? INDEX,
    read: (p) => fixtures[p] ?? "",
  });
}

const ids = (r, check) => r.findings.filter((f) => f.check === check).map((f) => f.id);

describe("C3 — chrome type scale", () => {
  it("flags a px literal, allows tokens and editor em ratios", () => {
    const r = run({
      "a.css": `.chrome-label { font-size: 12px; }
        .ok { font-size: var(--font-size-sm); }
        .tiptap-editor h1 { font-size: 2em; }`,
    });
    expect(ids(r, "C3")).toEqual(["a.css:.chrome-label"]);
  });

  it("accepts ui-ok(font) with a reason and refuses it bare", () => {
    const ok = run({ "a.css": `.x { font-size: 9px; /* ui-ok(font): fixture reason */ }` });
    expect(ids(ok, "C3")).toEqual([]);
    expect(ok.problems).toEqual([]);
    const bare = run({ "a.css": `.x { font-size: 9px; /* ui-ok(font): */ }` });
    expect(bare.problems.some((p) => p.includes("no reason"))).toBe(true);
  });
});

describe("C4 — overlay shells", () => {
  const shell = `.x-backdrop { position: fixed; z-index: var(--z-popup); background: var(--hover-bg-strong); }
    .x-panel { border: 1px solid var(--border-color); border-radius: var(--radius-lg); box-shadow: var(--popup-shadow); }`;

  it("joins backdrop and panel per FILE and reports one identity", () => {
    const r = run({ "a.css": shell });
    expect(ids(r, "C4")).toEqual(["a.css:.x-panel"]);
  });

  it("skips a panel composing .popup-container and a ui-ok(overlay) marker", () => {
    const composed = run({
      "a.css": `.popup-container.x { position: fixed; z-index: var(--z-popup); box-shadow: var(--popup-shadow); }`,
    });
    expect(ids(composed, "C4")).toEqual([]);
    const marked = run({
      "a.css": `.ghost { /* ui-ok(overlay): drag preview */ position: fixed; z-index: var(--z-popup); box-shadow: var(--popup-shadow); }`,
    });
    expect(ids(marked, "C4")).toEqual([]);
  });

  it("ignores low-z fixed elements (bars are not overlays)", () => {
    const r = run({ "a.css": `.bar { position: fixed; z-index: 100; box-shadow: var(--popup-shadow); }` });
    expect(ids(r, "C4")).toEqual([]);
  });

  it("flags a pointer-anchored menu using .context-menu without .vm-menu", () => {
    const r = run({
      "a.tsx": `export const C = () => <div role="menu" className="context-menu" style={{ left: 1, top: 2 }} />;`,
    });
    expect(ids(r, "C4")).toEqual(['a.tsx:<div role="menu">']);
  });

  it("accepts .vm-menu, a standalone menu class, and a stated ui-ok(overlay) reason", () => {
    const ok = run({
      "a.tsx": `export const C = () => (<>
        <div role="menu" className="vm-menu context-menu" style={{ left: 1, top: 2 }} />
        <div role="menu" className="universal-toolbar-dropdown" style={{ left: 1, top: 2 }} />
        <div role="menu" className="context-menu" />
      </>);`,
    });
    expect(ids(ok, "C4")).toEqual([]);
    const marked = run({
      "a.tsx": `export const C = () => (<div /* ui-ok(overlay): in-editor flyout */ role="menu" className="context-menu flyout" style={{ left: 1 }} />);`,
    });
    expect(ids(marked, "C4")).toEqual([]);
  });
});

describe("C5 — font roles", () => {
  it("flags chrome var(--font-sans); allows editor scope", () => {
    const r = run({
      "a.css": `.chrome { font-family: var(--font-sans); } .source-editor .cm-line { font-family: var(--font-sans); }`,
    });
    expect(ids(r, "C5")).toEqual(["a.css:.chrome"]);
  });
});

describe("C7 — icon sizes", () => {
  it("flags an off-set lucide size and ignores size={1} on a non-lucide import", () => {
    const r = run({
      "a.tsx": `import { Check } from "lucide-react";
        import { Background } from "@xyflow/react";
        export const C = () => <><Check size={13} /><Background size={1} /></>;`,
    });
    expect(ids(r, "C7")).toEqual(["a.tsx Check@13"]);
  });

  it("resolves a module-const size and accepts the sanctioned set", () => {
    const r = run({
      "a.tsx": `import { Check } from "lucide-react";
        const S = 16;
        export const C = () => <Check size={S} />;`,
    });
    expect(ids(r, "C7")).toEqual([]);
  });

  it("flags a CSS svg-width override in a dir whose TSX passes size=", () => {
    const r = run({
      "src/x/a.tsx": `import { Check } from "lucide-react"; export const C = () => <Check size={14} />;`,
      "src/x/a.css": `.find-bar-nav-btn svg { width: 16px; }`,
    });
    expect(ids(r, "C7")).toEqual(["src/x/a.css:.find-bar-nav-btn svg"]);
  });
});

describe("C8 — hit targets", () => {
  it("flags a sub-24px button, honours a ::before expander and ui-ok(target)", () => {
    const bad = run({ "a.css": `.mini-btn { width: 20px; height: 20px; }` });
    expect(ids(bad, "C8")).toEqual(["a.css:.mini-btn"]);
    const expanded = run({
      "a.css": `.mini-btn { width: 20px; } .mini-btn::before { content: ""; position: absolute; inset: -4px; }`,
    });
    expect(ids(expanded, "C8")).toEqual([]);
    const spaced = run({ "a.css": `.mini-btn { width: 20px; /* ui-ok(target): spaced — 8px gaps */ }` });
    expect(ids(spaced, "C8")).toEqual([]);
  });

  it("resolves var(--icon-size-sm) through index.css (22px < 24)", () => {
    const r = run({ "a.css": `.status-btn { width: var(--icon-size-sm); }` });
    expect(ids(r, "C8")).toEqual(["a.css:.status-btn"]);
  });

  it("does not double-count the @media (pointer: coarse) branch", () => {
    const r = run({
      "a.css": `.status-new-tab-btn { width: 20px; } @media (pointer: coarse) { .status-new-tab-btn { width: 20px; } }`,
    });
    expect(ids(r, "C8")).toEqual(["a.css:.status-new-tab-btn"]);
  });
});

describe("C9 — state vocabulary", () => {
  it("flags an off-vocabulary hover and accepts the vocabulary", () => {
    const r = run({
      "a.css": `.row:hover { background: var(--selection-color); } .ok:hover { background: var(--hover-bg); }`,
    });
    expect(ids(r, "C9")).toEqual(["a.css:.row:hover"]);
  });

  it("skips pseudo-element indicators and sanctioned families", () => {
    const r = run({
      "a.css": `.tab.active::before { background: var(--accent-primary); }
        .context-menu-item:hover { background: var(--primary-color); }
        ::-webkit-scrollbar-thumb:hover { background: var(--md-char-color); }`,
    });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("requires --accent-bg for a selected row; ui-ok(state) exempts the raised card", () => {
    const bad = run({ "a.css": `.file-node.selected { background: var(--subtle-bg-hover); }` });
    expect(ids(bad, "C9")).toEqual(["a.css:.file-node.selected"]);
    const card = run({
      "a.css": `.tab-pill.active { background: var(--bg-color); /* ui-ok(state): current-tab raised card */ }`,
    });
    expect(ids(card, "C9")).toEqual([]);
  });

  it("reads every selected-state spelling the ink half reads (BEM, ARIA, data-*)", () => {
    const r = run({
      "a.css": `.toggle__btn--active { background: var(--accent-primary); }
        .chip[aria-pressed="true"] { background: var(--hover-bg); }
        .pin[aria-checked="true"] { background: var(--subtle-bg); }`,
    });
    expect(ids(r, "C9")).toEqual([
      "a.css:.toggle__btn--active",
      'a.css:.chip[aria-pressed="true"]',
      'a.css:.pin[aria-checked="true"]',
    ]);
  });

  it("does not read a state inside :not() or an explicit false as a selection", () => {
    const r = run({
      "a.css": `.row:not(.active):hover { background: var(--hover-bg); }
        .row[aria-selected="false"]:hover { background: var(--hover-bg); }`,
    });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("exempts a semantic danger fill by its VALUE, not by a selector that says error", () => {
    const r = run({
      "a.css": `.delete-row:hover { background: var(--error-bg); }
        .row-error.active { background: var(--accent-primary); }`,
    });
    expect(ids(r, "C9")).toEqual(["a.css:.row-error.active"]);
  });
});

describe("C9 — selection keeps its ink (R6)", () => {
  // Accent is for the selection's FILL and its icons/indicators; the label keeps
  // --text-color. The background half of C9 never read `color:`, and its
  // selected-state pattern missed BEM modifiers and ARIA states, so accent-ink
  // selections shipped in the view-mode toggle, the pin list, the code-language
  // list and the canonical .vm-chip--toggle.
  it.each([
    [".seg__btn--active", "BEM modifier"],
    ['.pin-item[aria-checked="true"]', "aria-checked"],
    ['.vm-chip--toggle[aria-pressed="true"]', "aria-pressed"],
    ['.nav-link[aria-current="page"]', "aria-current"],
    [".lang-item.active", "plain .active with no background"],
    [".row.is-selected", ".is-* state"],
  ])("flags accent-coloured text on %s (%s)", (selector) => {
    const r = run({ "a.css": `${selector} { background: var(--accent-bg); color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([`a.css:${selector} (ink)`]);
  });

  it("also treats --primary-color as accent ink", () => {
    const r = run({ "a.css": `.toc-item.active { color: var(--primary-color); }` });
    expect(ids(r, "C9")).toEqual(["a.css:.toc-item.active (ink)"]);
  });

  it("accepts a selection that keeps --text-color", () => {
    const r = run({ "a.css": `.seg__btn--active { background: var(--accent-bg); color: var(--text-color); }` });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("accepts accent on the selection's icon or indicator", () => {
    const r = run({
      "a.css": `.item.active svg { color: var(--accent-primary); }
        .item--active .item__icon { color: var(--accent-primary); }
        .pin-item[aria-checked="true"] .pin-check { color: var(--accent-primary); }
        .dropdown-item.active::before { color: var(--accent-primary); }`,
    });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("accepts an icon-only control that says so with ui-ok(state)", () => {
    const r = run({
      "a.css": `.status-lock.active { color: var(--accent-primary); /* ui-ok(state): icon-only control — the glyph is the indicator */ }`,
    });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("does not treat hover as a selection", () => {
    const r = run({ "a.css": `.link:hover { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });

  // Codex review of #1465 (executed probes): the first version read the WHOLE
  // selector list at once, matched `-check` in an ancestor, required one
  // spelling of var(), and treated explicit false and non-selection states as
  // selections.
  it.each([
    ['.row[aria-selected="false"]'],
    ['.nav[aria-current="false"]'],
    [".row.is-loading"],
  ])("ignores a state that is not a selection: %s", (selector) => {
    const r = run({ "a.css": `${selector} { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("judges each selector in a list on its own", () => {
    const r = run({ "a.css": `.row.active .label, .row.active svg { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual(["a.css:.row.active .label (ink)"]);
  });

  it("reads the TARGET for indicator words, not an ancestor", () => {
    const r = run({ "a.css": `.list-check .row.active { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual(["a.css:.list-check .row.active (ink)"]);
  });

  // Codex second pass on #1465.
  it("does not read a negated state as a selection", () => {
    const r = run({ "a.css": `.row:not(.active) { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("reads an attribute state written with spaces around '='", () => {
    const r = run({ "a.css": `.row[aria-selected = "true"] { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([`a.css:.row[aria-selected = "true"] (ink)`]);
  });

  it("reads a spaced FALSE attribute as not selected (third pass)", () => {
    const r = run({ "a.css": `.row[aria-selected = "false"] { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });

  it("is not fooled by whitespace inside var()", () => {
    const r = run({ "a.css": `.row.active { color: var( --accent-primary ); }` });
    expect(ids(r, "C9")).toEqual(["a.css:.row.active (ink)"]);
  });
});

describe("C12 — nothing floats over content without a stated reason", () => {
  // The split-pane view-mode toggle was `position: absolute` at --z-toolbar,
  // pinned top-right OVER the panes — across the HTML trust bar, the read-only
  // banner, source text. C4 only looks at `fixed` overlays at --z-context-menu
  // and above, so nothing read it. Overlay families (popups, menus, dialogs)
  // are what the layer is for; everything else on a layer at or above --z-bar
  // must say why it may cover content.
  it("flags an absolutely positioned control on the toolbar layer", () => {
    const r = run({
      "a.css": `.pane__mode-toggle { position: absolute; top: var(--space-2); right: var(--space-3); z-index: var(--z-toolbar); }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane__mode-toggle"]);
  });

  it("flags a fixed element on the bar layer", () => {
    const r = run({ "a.css": `.floating-hint { position: fixed; bottom: 0; z-index: var(--z-bar); }` });
    expect(ids(r, "C12")).toEqual(["a.css:.floating-hint"]);
  });

  // Codex review of #1465 (executed probes).
  it("judges each selector in a list on its own — an overlay neighbour exempts nothing", () => {
    const r = run({
      "a.css": `.pane__toggle, .help-tooltip { position: absolute; z-index: var(--z-toolbar); }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane__toggle"]);
  });

  it("joins position and z-index declared in separate rules for one selector", () => {
    const r = run({
      "a.css": `.pane__toggle { position: absolute; top: 0; right: 0; }
        .pane__toggle { z-index: var(--z-toolbar); }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane__toggle"]);
  });

  it("resolves calc() around a z token", () => {
    const r = run({ "a.css": `.pane__toggle { position: absolute; z-index: calc(var(--z-toolbar) + 1); }` });
    expect(ids(r, "C12")).toEqual(["a.css:.pane__toggle"]);
  });

  // Codex second pass on #1465: contexts are not interchangeable, and the
  // LAST declaration in a context is the one that applies.
  it("keeps @media contexts apart: a wide-screen overlay is flagged even if narrow screens reset it", () => {
    const r = run({
      "a.css": `.pane { position: absolute; z-index: var(--z-toolbar); }
        @media (max-width: 600px) { .pane { position: static; z-index: 1; } }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane"]);
  });

  it("uses the effective declaration: a later position: static wins", () => {
    const r = run({
      "a.css": `.pane { position: absolute; }
        .pane { position: static; z-index: var(--z-toolbar); }`,
    });
    expect(ids(r, "C12")).toEqual([]);
  });

  it("flags an overlay that exists only inside an @media block", () => {
    const r = run({
      "a.css": `@media (min-width: 900px) { .pane__toggle { position: absolute; z-index: var(--z-toolbar); } }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane__toggle"]);
  });

  // Codex third pass on #1465 — the cascade, not a merge.
  it("takes the LAST declaration within one rule", () => {
    const r = run({ "a.css": `.pane { position: static; position: absolute; z-index: 1; z-index: var(--z-toolbar); }` });
    expect(ids(r, "C12")).toEqual(["a.css:.pane"]);
  });

  it("a later unconditional reset overrides an earlier @media rule", () => {
    const r = run({
      "a.css": `@media (min-width: 900px) { .pane { position: absolute; z-index: var(--z-toolbar); } }
        .pane { position: static; }`,
    });
    expect(ids(r, "C12")).toEqual([]);
  });

  it("composes nested contexts: @media position + nested @supports z-index", () => {
    const r = run({
      "a.css": `@media (min-width: 900px) { .pane { position: absolute; } @supports (display: grid) { .pane { z-index: var(--z-toolbar); } } }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane"]);
  });

  it("is not derailed by braces inside strings", () => {
    const r = run({
      "a.css": `.a { content: "}"; } .b { background: url("x{y}.png"); }
        .pane { position: absolute; z-index: var(--z-toolbar); }
        @media (max-width: 600px) { .pane { position: static; } }`,
    });
    expect(ids(r, "C12")).toEqual(["a.css:.pane"]);
  });

  it("ignores @keyframes steps", () => {
    const r = run({
      "a.css": `@keyframes slide { from { position: absolute; z-index: var(--z-toolbar); } to { position: absolute; z-index: var(--z-toolbar); } }`,
    });
    expect(ids(r, "C12")).toEqual([]);
  });

  it("accepts overlay families, low layers, in-flow elements and stated reasons", () => {
    const r = run({
      "a.css": `.link-popup { position: fixed; z-index: var(--z-popup); }
        .vm-menu { position: fixed; z-index: var(--z-context-menu); }
        .resize-grip { position: absolute; z-index: var(--z-resize-handle); }
        .pane__header { position: relative; z-index: var(--z-toolbar); }
        .status-bar-container { position: fixed; z-index: var(--z-bar); /* ui-ok(float): layer owner — rule 32 z-table (StatusBar) */ }`,
    });
    expect(ids(r, "C12")).toEqual([]);
  });
});

describe("C10 — focus visibility", () => {
  it("flags a button whose classes paint nothing on focus; accepts a painting rule", () => {
    const r = run({
      "a.tsx": `export const C = () => <button className="plain-btn">x</button>;`,
      "a.css": `.plain-btn { color: red; }`,
    });
    expect(ids(r, "C10")).toEqual(["a.tsx <button>.plain-btn"]);
    const ok = run({
      "a.tsx": `export const C = () => <button className="good-btn">x</button>;`,
      "a.css": `.good-btn:focus-visible { outline: 2px solid var(--accent-primary); }`,
    });
    expect(ids(ok, "C10")).toEqual([]);
  });

  it("honours the caret-only marker and Tailwind focus-visible classes", () => {
    const caret = run({
      "a.tsx": `export const C = () => <input className="popup-input" />;`,
      "a.css": `/* focus: caret-only — borderless popup input */\n.popup-input:focus { outline: none; }`,
    });
    expect(ids(caret, "C10")).toEqual([]);
    const tw = run({
      "a.tsx": `export const C = () => <button className="flex focus-visible:outline-2">x</button>;`,
    });
    expect(ids(tw, "C10")).toEqual([]);
  });

  it("resolves template-literal and const classNames", () => {
    const r = run({
      "a.tsx": `const CLS = "resolved-btn";
        export const C = () => <><button className={CLS}>a</button><button className={\`x \${CLS}\`}>b</button></>;`,
      "a.css": `.resolved-btn:focus-visible { background: var(--hover-bg); }`,
    });
    expect(ids(r, "C10")).toEqual([]);
  });

  it("covers selects, textareas, inputs, href anchors and tabIndex={0}", () => {
    const r = run({
      "a.tsx": `export const C = () => <>
        <select className="s" />
        <a href="/x" className="l">l</a>
        <a className="no-href">n</a>
        <div tabIndex={0} className="d" />
      </>;`,
    });
    expect(ids(r, "C10").sort()).toEqual(["a.tsx <a>.l", "a.tsx <div>.d", "a.tsx <select>.s"]);
  });
});

describe("C11 — heights and z-index", () => {
  it("flags a bar-height literal; allows a local --*-height var and index.css", () => {
    const r = run({
      "a.css": `.some-bar { height: 40px; } .find-bar { --find-bar-height: 38px; height: 38px; }`,
    });
    expect(ids(r, "C11")).toEqual(["a.css:.some-bar"]);
  });

  it("reports z-index literals > 2 as zero-tolerance", () => {
    const r = run({ "a.css": `.x { z-index: 50; } .ok { z-index: var(--z-popup); }` });
    expect(r.zFindings).toHaveLength(1);
  });
});

describe("marker grammar", () => {
  it("rejects a reason that is only punctuation", () => {
    const { problems } = uiOkMarkers("/* ui-ok(state): —— */");
    expect(problems).toHaveLength(1);
  });
});

describe("compareBaseline", () => {
  const finding = { check: "C9", id: "a.css:.x:hover", message: "m" };
  it("new findings fail; stale entries fail; baselined pass", () => {
    const empty = { C9: [] };
    expect(compareBaseline([finding], empty).newFindings).toHaveLength(1);
    const stale = { C9: ["a.css:.gone:hover"] };
    expect(compareBaseline([], stale).stale).toEqual([{ check: "C9", id: "a.css:.gone:hover" }]);
    const good = { C9: ["a.css:.x:hover"] };
    const r = compareBaseline([finding], good);
    expect(r.newFindings).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});

describe("the real tree", () => {
  it("pnpm lint:ui-consistency is green against the committed baseline", () => {
    // No wall-clock assertion here: this tier runs inside check:predelta's
    // 8-way pool where every duration measures machine load, not the gate
    // (see vitest.gates.config.ts's header). The <3s budget claim is a
    // STANDALONE property — measured 0.6–2.2s alone on the full tree.
    execFileSync(process.execPath, ["scripts/check-ui-consistency.mjs"], { stdio: "pipe" });
  });
});

describe("C3's Tailwind half — the @theme bridge is required (WI-UI2.2)", () => {
  it("fails when index.css lacks the @theme inline bridge", () => {
    const r = run({ "src/styles/index.css": ":root { --z-popup: 9999; }" });
    expect(r.problems.some((p) => p.includes("@theme inline bridge"))).toBe(true);
  });
});

describe("C6 — reduced motion has one owner (WI-UI1.7)", () => {
  it("fails when index.css lacks the global duration-collapse block", () => {
    const r = run({ "src/styles/index.css": ":root { --z-popup: 9999; }" });
    expect(r.problems.some((p) => p.includes("duration-collapse"))).toBe(true);
  });

  it("REPORTS (not fails) a per-file block outside the resting-state allowlist", () => {
    const globalBlock = `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }`;
    const r = run({
      "src/styles/index.css": `${INDEX} ${globalBlock}`,
      "a.css": `@media (prefers-reduced-motion: reduce) { .x { animation: none; } }`,
    });
    expect(r.problems.filter((p) => p.includes("duration-collapse"))).toEqual([]);
    expect(r.reports.some((x) => x.includes("a.css"))).toBe(true);
    expect(r.findings.filter((f) => f.id.includes("a.css"))).toEqual([]);
  });

  it("allowlists the resting-state files", () => {
    const globalBlock = `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }`;
    const r = run({
      "src/styles/index.css": `${INDEX} ${globalBlock}`,
      "src/plugins/syntaxReveal/syntax-reveal.css": `@media (prefers-reduced-motion: reduce) { .y { opacity: 1; } }`,
    });
    expect(r.reports).toEqual([]);
  });
});

describe("focusPaintedClasses (C10's CSS half)", () => {
  it("covers only the compound that CARRIES the :focus pseudo-class", () => {
    const css = `.tiptap-editor .code-copy-btn:focus-visible { outline: 2px solid var(--accent-primary); }`;
    const covered = focusPaintedClasses(css);
    expect(covered.has("code-copy-btn")).toBe(true);
    expect(covered.has("tiptap-editor")).toBe(false);
  });

  it("a hover rule that YIELDS to focus via :not(:focus-visible) is not focus coverage", () => {
    // universal-toolbar.css's real hover rule — before :not() blanking it
    // marked the class covered by its hover paint.
    const css = `.universal-toolbar-btn:hover:not(:disabled):not(:focus-visible) { background-color: var(--bg-tertiary); }`;
    expect(focusPaintedClasses(css).has("universal-toolbar-btn")).toBe(false);
  });

  it("a brace inside a comment does not desynchronize marker attribution", () => {
    const css = `/* a comment with a { brace */
.a:focus-visible { outline: 2px solid var(--accent-primary); }
/* focus: caret-only — borderless input; the caret is the indicator */
.b:focus { outline: none; }`;
    const covered = focusPaintedClasses(css);
    expect(covered.has("a")).toBe(true);
    expect(covered.has("b")).toBe(true);
  });
});

describe("Codex fourth pass — C12 and C9 probes", () => {
  it("C12: a quoted brace inside the floating rule does not end it", () => {
    const r = run({ "a.css": `.pane { --label: "}"; position: absolute; z-index: var(--z-toolbar); }` });
    expect(ids(r, "C12")).toEqual(["a.css:.pane"]);
  });

  it.each([
    [`.pane { position: absolute; z-index: var(--z-toolbar) !important; }`],
    [`.pane { position: absolute !important; position: static; z-index: var(--z-toolbar); }`],
    [`.pane { position: absolute !important; z-index: var(--z-toolbar); } .pane { position: static; }`],
  ])("C12: !important wins the cascade — floats: %s", (css) => {
    expect(ids(run({ "a.css": css }), "C12")).toEqual(["a.css:.pane"]);
  });

  it("C12: an important static position keeps the element in flow", () => {
    const r = run({ "a.css": `.pane { position: static !important; position: absolute; z-index: var(--z-toolbar); }` });
    expect(ids(r, "C12")).toEqual([]);
  });

  // A GROWTH EXPONENT, not a duration (the method of pathologicalScaling.test.ts):
  // CPU time of this thread (src/test/cpuClock.ts), five rounds of one small
  // and one large sample with the minimum of each side kept. The cubic loop
  // this replaced grew ~64× for 4× the rules; linear grows ~4×.
  it("C12: scales linearly on a stylesheet of many @media rules", () => {
    const sheet = (n) =>
      Array.from({ length: n }, (_, i) => `@media (min-width: ${i}px) { .p${i} { position: relative; z-index: var(--z-bar); } }`).join("\n");
    const small = sheet(400);
    const large = sheet(1600);
    const cost = measureGrowth((css) => expect(ids(run({ "a.css": css }), "C12")).toEqual([]), small, large);
    const exponent = growthExponent(cost, small.length, large.length);
    expect(
      exponent,
      `400 rules ${cost.smallMs.toFixed(1)}ms → 1600 rules ${cost.largeMs.toFixed(1)}ms on the ${cost.clock} clock`,
    ).toBeLessThan(1.35);
  });

  it.each([[":is"], [":where"]])("C9: an icon alternative inside %s() does not exempt the selected label", (fn) => {
    const selector = `${fn}(.row.selected, .row-icon)`;
    const r = run({ "a.css": `${selector} { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([`a.css:${selector} (ink)`]);
  });

  it("C9: a selected row's icon, reached through :is(), is still an indicator", () => {
    const r = run({ "a.css": `.row:is(.selected, .active) .row-icon { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });
});

describe("Codex fifth pass — C9 probes", () => {
  it("background: a sanctioned :is() alternative exempts only itself", () => {
    const r = run({ "a.css": `:is(.row[aria-selected="true"], .menu-item:hover) { background: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([`a.css::is(.row[aria-selected="true"], .menu-item:hover)`]);
  });

  it("background: a semantic token only as a var() fallback exempts nothing", () => {
    const r = run({ "a.css": `.row[aria-selected="true"] { background: var(--accent-primary, var(--error-color)); }` });
    expect(ids(r, "C9")).toEqual([`a.css:.row[aria-selected="true"]`]);
  });

  it("ink: spaces inside an attribute do not split the target compound", () => {
    const r = run({ "a.css": `.row-icon[aria-selected = "true"] { color: var(--accent-primary); }` });
    expect(ids(r, "C9")).toEqual([]);
  });
});

describe("Codex sixth pass — C9 target reading", () => {
  it.each([[`.row.selected:not(.row-icon .label)`], [`.row.selected:has(.row-icon)`]])(
    "an icon named only inside :not()/:has() does not make %s an indicator",
    (selector) => {
      const r = run({ "a.css": `${selector} { color: var(--accent-primary); }` });
      expect(ids(r, "C9")).toEqual([`a.css:${selector} (ink)`]);
    },
  );
});
