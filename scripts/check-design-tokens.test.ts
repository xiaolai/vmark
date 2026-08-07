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
import { collectJsDefinedVars, findFocusRemovals } from "./check-design-tokens.mjs";

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
