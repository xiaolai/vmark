// WI-UI0.3 — self-test for the ui-consistency gate (C3–C11).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { runChecks, compareBaseline } from "./check-ui-consistency.mjs";
import { focusPaintedClasses, uiOkMarkers } from "./lib/uiConsistencyCss.mjs";

const INDEX = `@theme inline { --text-sm: var(--font-size-base); --font-sans: var(--font-ui); --shadow-popup: var(--shadow-popup); }
:root { --z-context-menu: 1000; --z-popup: 9999; --icon-size-sm: 22px; --font-size-sm: 12px; }
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
