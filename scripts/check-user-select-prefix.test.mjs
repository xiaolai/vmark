import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findCssViolations, findScriptViolations } from "./check-user-select-prefix.mjs";

describe("findCssViolations", () => {
  it("accepts a rule carrying both properties with the same value", () => {
    const css = ".a {\n  -webkit-user-select: none;\n  user-select: none;\n}";
    expect(findCssViolations(css)).toEqual([]);
  });

  it("accepts either declaration order", () => {
    const css = ".a { user-select: text; -webkit-user-select: text; }";
    expect(findCssViolations(css)).toEqual([]);
  });

  it("reports the line of an unprefixed declaration", () => {
    const css = ".a {\n  color: red;\n  user-select: none;\n}";
    expect(findCssViolations(css)).toEqual([
      { line: 3, message: "user-select: none has no matching -webkit-user-select" },
    ]);
  });

  it("reports a prefixed declaration whose value disagrees", () => {
    const css = ".a { -webkit-user-select: none; user-select: text; }";
    expect(findCssViolations(css)).toHaveLength(1);
  });

  it("reports a prefix with no standard property", () => {
    const css = ".a {\n  -webkit-user-select: none;\n}";
    expect(findCssViolations(css)[0].line).toBe(2);
  });

  it("does not let a neighbouring rule supply the prefix", () => {
    const css = ".a { -webkit-user-select: none; user-select: none; }\n.b { user-select: none; }";
    expect(findCssViolations(css)).toHaveLength(1);
    expect(findCssViolations(css)[0].line).toBe(2);
  });

  it("checks rules nested in an at-rule", () => {
    const css = "@media print {\n  .a {\n    user-select: none;\n  }\n}";
    expect(findCssViolations(css)[0].line).toBe(3);
  });

  it("ignores comments and keeps line numbers right after them", () => {
    const css = "/* user-select: none;\n   more */\n.a {\n  user-select: none;\n}";
    expect(findCssViolations(css)).toEqual([
      { line: 4, message: "user-select: none has no matching -webkit-user-select" },
    ]);
  });

  it("does not mistake a similarly named custom property", () => {
    expect(findCssViolations(".a { --user-select: none; }")).toEqual([]);
  });
});

describe("findScriptViolations", () => {
  it("reports an inline write that WebKit ignores", () => {
    expect(findScriptViolations(`document.body.style.userSelect = "none";`)).toEqual([
      { line: 1, message: "style.userSelect has no effect in WebKit; use bodyTextSelection" },
    ]);
  });

  it("ignores a read and an unrelated name", () => {
    expect(findScriptViolations(`const a = el.style.userSelect;\nconst b = userSelect;`)).toEqual([]);
  });

  it("ignores a comparison", () => {
    expect(findScriptViolations(`if (el.style.userSelect === "none") go();`)).toEqual([]);
  });
});

describe("the repository", () => {
  it("is green against the gate", () => {
    const out = execFileSync("node", ["scripts/check-user-select-prefix.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/\d+ CSS files? and \d+ script files? checked/);
  });
});
