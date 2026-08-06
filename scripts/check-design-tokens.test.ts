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
import { collectJsDefinedVars } from "./check-design-tokens.mjs";

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
