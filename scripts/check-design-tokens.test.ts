// WI-UI0.2 — declaration-integrity checks (C2a–C2g); WI-UI0.6 — the C2f
// parity cases pin the reconciled rule-31 token tables.
/**
 * Regression tests for the design-token gate's JS-emitted-token collector.
 *
 * This gate has an `undefined-css-var` check at ERROR severity, added
 * specifically to catch a `var(--x)` with no definition — CSS discards the whole
 * declaration, silently. It nonetheless stayed green while the entire
 * `--spacing-*` family was undefined, costing 133 padding/margin/gap
 * declarations across 13 components.
 *
 * The cause was here: the collector accepted a quoted var name followed by a
 * colon OR A COMMA, so `src/export/themeSnapshot.ts` — which merely LISTS those
 * names in an array to read them back via getPropertyValue — marked the whole
 * family "defined". These tests pin the distinction so the false negative
 * cannot return.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectJsDefinedVars, findFocusRemovals, globFiles } from "./check-design-tokens.mjs";

describe("collectJsDefinedVars", () => {
  it("collects setProperty() calls", () => {
    expect([...collectJsDefinedVars(`el.style.setProperty("--bg-color", v);`)]).toEqual([
      "--bg-color",
    ]);
  });

  it("collects object-literal keys", () => {
    expect([...collectJsDefinedVars(`const m = { "--editor-font-size": size };`)]).toEqual([
      "--editor-font-size",
    ]);
  });

  it("does NOT collect array elements — they are reads, not definitions", () => {
    // Verbatim shape of src/export/themeSnapshot.ts's EXPORT_CSS_VARS list,
    // whose entries are passed to getPropertyValue().
    const source = `const EXPORT_CSS_VARS = [\n  "--spacing-1",\n  "--spacing-2",\n  "--spacing-3",\n] as const;`;
    expect([...collectJsDefinedVars(source)]).toEqual([]);
  });

  it("separates a definition from a read in the same file", () => {
    const source = `
      const READ = ["--spacing-2"];
      el.style.setProperty("--bg-color", v);
      const map = { "--text-color": c };
    `;
    expect([...collectJsDefinedVars(source)].sort()).toEqual(["--bg-color", "--text-color"]);
  });

  it("accepts single quotes and backticks", () => {
    const source = `setProperty('--a', v); const m = { \`--b\`: v };`;
    expect([...collectJsDefinedVars(source)].sort()).toEqual(["--a", "--b"]);
  });

  it("tolerates whitespace before the colon", () => {
    expect([...collectJsDefinedVars(`const m = { "--a" : v };`)]).toEqual(["--a"]);
  });

  it("returns nothing for source with no custom properties", () => {
    expect([...collectJsDefinedVars(`const a = 1; foo("bar");`)]).toEqual([]);
  });
});

/**
 * The focus-removal check used to be a bare regex for `:focus { … outline: none }`
 * and carried the comment "Review manually — some have replacement indicators".
 * That is an admission that it cries wolf, and it did: all four findings in the
 * repo were text inputs using the caret-only convention that
 * `.claude/rules/33-focus-indicators.md` §2 explicitly sanctions, three of them
 * with a `:focus-visible` background hint declared immediately below.
 *
 * A warning that is always wrong is worse than no warning — it trains the reader
 * to skip the whole gate, including the day it catches a real one. These tests
 * pin that a genuine removal still fires.
 */
describe("findFocusRemovals", () => {
  const removal = `.btn:focus { outline: none; box-shadow: none; }`;

  it("flags a focus removal with no replacement at all", () => {
    expect(findFocusRemovals(removal).map((v) => v.selector)).toEqual([".btn:focus"]);
  });

  it("accepts a :focus-visible rule that supplies a background", () => {
    const css = `${removal}\n.btn:focus-visible { outline: none; background: var(--hover-bg); }`;
    expect(findFocusRemovals(css)).toEqual([]);
  });

  it("accepts a :focus-visible rule that supplies an outline", () => {
    const css = `${removal}\n.btn:focus-visible { outline: 2px solid var(--primary-color); }`;
    expect(findFocusRemovals(css)).toEqual([]);
  });

  it("accepts a :focus-visible rule that supplies a box-shadow", () => {
    const css = `${removal}\n.btn:focus-visible { box-shadow: 0 0 0 2px var(--accent-bg); }`;
    expect(findFocusRemovals(css)).toEqual([]);
  });

  it("is NOT satisfied by a :focus-visible that also removes everything", () => {
    // The replacement has to be visible. A second rule that only sets
    // `outline: none` again is the same defect wearing a different selector.
    const css = `${removal}\n.btn:focus-visible { outline: none; box-shadow: none; }`;
    expect(findFocusRemovals(css)).toHaveLength(1);
  });

  it("accepts an explicit caret-only marker", () => {
    const css = `/* focus: caret-only — inline rename field, caret is the indicator */\n${removal}`;
    expect(findFocusRemovals(css)).toEqual([]);
  });

  it("requires the marker to state a reason", () => {
    // A bare opt-out token is a mute button. The reason is the whole point.
    const css = `/* focus: caret-only */\n${removal}`;
    expect(findFocusRemovals(css)).toHaveLength(1);
  });

  it("does not let one rule's marker excuse a later unmarked rule", () => {
    const css =
      `/* focus: caret-only — the input, deliberately */\n.a:focus { outline: none; }\n` +
      `.b:focus { outline: none; }`;
    expect(findFocusRemovals(css).map((v) => v.selector)).toEqual([".b:focus"]);
  });

  it("handles a comma-separated selector list, needing cover for every member", () => {
    const css =
      `.src:focus, .alt:focus { outline: none; }\n` +
      `.src:focus-visible { background: var(--hover-bg); }`;
    // `.alt` is uncovered, so the rule is still a finding.
    expect(findFocusRemovals(css)).toHaveLength(1);

    const both = `${css}\n.alt:focus-visible { background: var(--hover-bg); }`;
    expect(findFocusRemovals(both)).toEqual([]);
  });

  it("ignores a :focus rule that removes nothing", () => {
    expect(findFocusRemovals(`.btn:focus { color: red; }`)).toEqual([]);
  });

  it("does not treat :focus-visible itself as a removal", () => {
    // Otherwise every sanctioned `:focus-visible { outline: none; … }` that
    // draws its own ::after underline would report as a violation.
    expect(findFocusRemovals(`.btn:focus-visible { outline: none; }`)).toEqual([]);
  });

  it("reports a line number for the finding", () => {
    const css = `.x { color: red; }\n\n${removal}`;
    expect(findFocusRemovals(css)[0].line).toBe(3);
  });
});

describe("globFiles", () => {
  // The gate globs `src/**/*.{ts,tsx}` and readFileSync's every hit. Vitest's
  // browser runner writes screenshot artifacts into a `__screenshots__`
  // directory named after the TEST FILE, so after any `*.webkit.test.ts`
  // failure there is a DIRECTORY whose name ends in `.ts`. Those directories
  // are gitignored — expected on a developer machine — and feeding one to
  // readFileSync threw an unhandled EISDIR that killed the gate with a raw Node
  // stack trace, reading as "the token checker is broken".
  it("excludes a directory whose name ends in a source extension", () => {
    const root = mkdtempSync(join(tmpdir(), "globfiles-"));
    try {
      writeFileSync(join(root, "real.ts"), "export {};");
      mkdirSync(join(root, "__screenshots__"));
      mkdirSync(join(root, "__screenshots__", "some.webkit.test.ts"));

      const hits = globFiles(join(root, "**/*.{ts,tsx}"));

      expect(hits).toContain(join(root, "real.ts"));
      expect(hits.some((p: string) => p.endsWith("some.webkit.test.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns every regular file that matches", () => {
    const root = mkdtempSync(join(tmpdir(), "globfiles-"));
    try {
      writeFileSync(join(root, "a.ts"), "");
      writeFileSync(join(root, "b.tsx"), "");
      writeFileSync(join(root, "c.css"), "");
      expect(globFiles(join(root, "**/*.{ts,tsx}")).sort()).toEqual(
        [join(root, "a.ts"), join(root, "b.tsx")].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── WI-UI0.2 — declaration integrity (C2a–C2g) ──────────────────────────────

import { execFileSync } from "node:child_process";
import {
  findColorFnLiterals,
  findDuplicateDeclarations,
  collectKeyframes,
  findMissingKeyframes,
  findUndefinedVarFallbacks,
  docTokensFromRule31,
  rule31Parity,
} from "./lib/designTokenChecks.mjs";
import { findClassNameLiterals } from "./lib/designTokensTsx.mjs";

describe("C2b — colour-function literals", () => {
  it("flags a bare rgba literal by file:selector:prop:value (per DECLARATION)", () => {
    const css = `.x { background: rgba(0, 0, 0, 0.3); }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual(["f.css:.x:background:rgba(0, 0, 0, 0.3)"]);
  });

  it("a CHANGED literal on a frozen declaration is a new identity (value is part of it)", () => {
    const css = `.x { background: rgba(0, 0, 0, 0.5); }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:.x:background:rgba(0, 0, 0, 0.5)",
    ]);
  });

  it("a second literal on another property of a baselined selector is a SECOND identity", () => {
    // The per-rule identity let a baselined selector accumulate new colour
    // literals invisibly — verified by mutation before the re-measurement.
    const css = `.x { background: rgba(0, 0, 0, 0.3); color: rgb(10, 10, 10); }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:.x:background:rgba(0, 0, 0, 0.3)",
      "f.css:.x:color:rgb(10, 10, 10)",
    ]);
  });

  it("a step-shaped selector OUTSIDE any @keyframes block gets no owner prefix", () => {
    // The selector must MATCH the step grammar or the fixture proves nothing —
    // nearest-preceding-index attribution would have stamped `@keyframes pulse`
    // onto this top-level `from` rule; balanced ranges do not.
    const css = `@keyframes pulse { 0% { opacity: 0; } }
from { background: rgba(9, 9, 9, 0.1); }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:from:background:rgba(9, 9, 9, 0.1)",
    ]);
  });

  it("identical repeated declarations get occurrence ordinals (set-compare cannot collapse them)", () => {
    const css = `.x { background: rgba(0, 0, 0, 0.3); background: rgba(0, 0, 0, 0.3); }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:.x:background:rgba(0, 0, 0, 0.3)",
      "f.css:.x:background:rgba(0, 0, 0, 0.3)#2",
    ]);
  });

  it("fractional keyframe steps (.5%) are recognized and prefixed", () => {
    const css = `@keyframes pulse { .5% { background: rgba(1, 1, 1, 0.1); } }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:@keyframes pulse .5%:background:rgba(1, 1, 1, 0.1)",
    ]);
  });

  it("keyframe steps are disambiguated by their enclosing @keyframes name", () => {
    const css = `@keyframes pulse { 0% { background: rgba(1, 2, 3, 0.1); } }
@keyframes fade { 0% { background: rgba(4, 5, 6, 0.1); } }`;
    expect(findColorFnLiterals(css, "f.css").map((f) => f.id)).toEqual([
      "f.css:@keyframes pulse 0%:background:rgba(1, 2, 3, 0.1)",
      "f.css:@keyframes fade 0%:background:rgba(4, 5, 6, 0.1)",
    ]);
  });

  it("skips an rgba immediately followed by color-mix on the SAME property (rule 31 fallback)", () => {
    const css = `.x {
      background: rgba(207, 34, 46, 0.03);
      background: color-mix(in srgb, var(--error-color) 3%, transparent);
    }`;
    expect(findColorFnLiterals(css, "f.css")).toEqual([]);
  });

  it("does NOT let a color-mix on a DIFFERENT property excuse the literal", () => {
    const css = `.x {
      background: rgba(207, 34, 46, 0.03);
      border-color: color-mix(in srgb, var(--error-color) 3%, transparent);
    }`;
    expect(findColorFnLiterals(css, "f.css")).toHaveLength(1);
  });
});

describe("C2c — duplicate declarations in a token block", () => {
  it("flags the same property declared twice in one :root block", () => {
    const css = `:root { --a: 1px; --b: 2px; --a: 3px; }`;
    expect(findDuplicateDeclarations(css, "f.css").map((f) => f.name)).toEqual(["--a"]);
  });

  it("allows the same name in :root AND .dark-theme (the theme mechanism)", () => {
    const css = `:root { --a: white; } .dark-theme { --a: black; }`;
    expect(findDuplicateDeclarations(css, "f.css")).toEqual([]);
  });

  it("still finds :root when statements precede it (index.css's @import preamble)", () => {
    const css = `@import "tailwindcss";\n@custom-variant dark (&:where(.dark));\n:root { --a: 1; --a: 2; }`;
    expect(findDuplicateDeclarations(css, "f.css")).toHaveLength(1);
  });

  it("allows the rgba-then-color-mix pair for one custom property", () => {
    const css = `:root { --a: rgba(0,0,0,.1); --a: color-mix(in srgb, black 10%, transparent); }`;
    expect(findDuplicateDeclarations(css, "f.css")).toEqual([]);
  });
});

describe("C2d — keyframe joins", () => {
  it("flags an animation-name with no @keyframes anywhere", () => {
    const css = `.x { animation: ghost-fade 0.1s ease-out; }`;
    expect(findMissingKeyframes(css, "f.css", new Set(["popup-fade-in"])).map((f) => f.name)).toEqual([
      "ghost-fade",
    ]);
  });

  it("accepts a declared name and ignores keywords/durations", () => {
    const css = `.x { animation: popup-fade-in 0.1s ease-out infinite; }`;
    expect(findMissingKeyframes(css, "f.css", collectKeyframes("@keyframes popup-fade-in { from {} }"))).toEqual([]);
  });
});

describe("C2e — undefined var with a fallback", () => {
  it("flags a fallback var defined nowhere", () => {
    const css = `.x { background: var(--ghost, blue); }`;
    expect(findUndefinedVarFallbacks(css, "f.css", new Set(["--real"])).map((f) => f.name)).toEqual([
      "--ghost",
    ]);
  });

  it("allows a fallback whose var IS defined", () => {
    const css = `.x { background: var(--real, blue); }`;
    expect(findUndefinedVarFallbacks(css, "f.css", new Set(["--real"]))).toEqual([]);
  });
});

describe("C2f — rule-31 parity", () => {
  it("reads tokens from the first TWO table columns (the primitives table)", () => {
    const md = [
      "| Token | Purpose |",
      "|---|---|",
      "| `--first-col` | something |",
      "| Spacing (px) | `--in-second-col` (4) |",
    ].join("\n");
    const tokens = docTokensFromRule31(md);
    expect(tokens.has("--first-col")).toBe(true);
    expect(tokens.has("--in-second-col")).toBe(true);
  });

  it("does NOT count a prose mention — `--bg-hover` \"does not exist\"", () => {
    const md = "Use `--hover-bg`, never `--bg-hover` or `--bg-active` (those don't exist).";
    expect(docTokensFromRule31(md).size).toBe(0);
  });

  it("flags documented-not-declared, declared-undocumented and zero-consumer tokens", () => {
    const findings = rule31Parity({
      indexCss: ":root {\n  --declared-doc: 1px;\n  --declared-undoc: 2px;\n}",
      ruleMd: "| `--declared-doc` | x |\n| `--ghost-token` | y |",
      declaredVars: new Set(["--declared-doc", "--declared-undoc"]),
      consumedVars: new Set(["--declared-doc"]),
    });
    expect(findings.some((f) => f.includes("--ghost-token") && f.includes("declared nowhere"))).toBe(true);
    expect(findings.some((f) => f.includes("--declared-undoc") && f.includes("no rule-31 table row"))).toBe(true);
    expect(findings.some((f) => f.includes("--declared-undoc") && f.includes("no consumer"))).toBe(true);
  });

  it("honours reasoned markers and refuses a bare marker", () => {
    const ok = rule31Parity({
      indexCss: ":root {\n  --x: 1px; /* token-doc-ok: internal plumbing */ /* token-unused-ok: consumers land later */\n}",
      ruleMd: "",
      declaredVars: new Set(["--x"]),
      consumedVars: new Set(),
    });
    expect(ok).toEqual([]);
    const bare = rule31Parity({
      indexCss: ":root {\n  --x: 1px; /* token-doc-ok */\n}",
      ruleMd: "| `--x` | y |",
      declaredVars: new Set(["--x"]),
      consumedVars: new Set(["--x"]),
    });
    expect(bare.some((f) => f.includes("no reason"))).toBe(true);
  });
});

describe("C2g — className literals (TS AST)", () => {
  it("flags a palette class inside a template-literal className", () => {
    const src = 'export const C = () => <div className={`p-2 ${x ? "ring-2 ring-gray-400" : ""}`} />;';
    const found = findClassNameLiterals(src, "f.tsx");
    expect(found.map((f) => f.token)).toContain("ring-gray-400");
  });

  it("flags bg-black/50, text-[10px] and z-50; ignores token-backed arbitrary values", () => {
    const src = 'export const C = () => <div className="bg-black/50 text-[10px] z-50 ring-[var(--border-color)] z-[var(--z-popup)]" />;';
    const tokens = findClassNameLiterals(src, "f.tsx").map((f) => f.token).sort();
    expect(tokens).toEqual(["bg-black/50", "text-[10px]", "z-50"]);
  });

  it("ignores strings outside className attributes", () => {
    const src = 'const note = "ring-gray-400 is banned"; export const C = () => <div className="p-2" />;';
    expect(findClassNameLiterals(src, "f.tsx")).toEqual([]);
  });
});

describe("the CLI in fixture mode", () => {
  it("exits 1 for a fixture containing #abcdef", () => {
    const root = mkdtempSync(join(tmpdir(), "design-tokens-"));
    try {
      const fixture = join(root, "bad.css");
      writeFileSync(fixture, ".x { color: #abcdef; }\n");
      let status = 0;
      try {
        execFileSync(process.execPath, ["scripts/check-design-tokens.mjs", fixture], { stdio: "pipe" });
      } catch (e) {
        status = (e as { status?: number }).status ?? -1;
      }
      expect(status).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is green against the real tree and the committed baseline", () => {
    execFileSync(process.execPath, ["scripts/check-design-tokens.mjs"], { stdio: "pipe" });
  });
});
