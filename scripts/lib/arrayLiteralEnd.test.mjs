// The balanced array scanner behind check-keybinding-manifest.mjs's arrayBody.
import { describe, it, expect } from "vitest";
import { arrayLiteralEnd } from "./arrayLiteralEnd.mjs";

/** The array literal opened at the first `[` after `=` (the VALUE, not a type annotation's brackets). */
const body = (src, lang = "ts") => {
  const open = src.indexOf("[", src.indexOf("="));
  return src.slice(open, arrayLiteralEnd(src, open, { lang }) + 1);
};

describe("arrayLiteralEnd", () => {
  it("finds the matching bracket of a flat array", () => {
    expect(body('const A = ["a", "b"];\n')).toBe('["a", "b"]');
  });

  it("balances nested arrays", () => {
    expect(body("const A = [[1, [2]], [3]];")).toBe("[[1, [2]], [3]]");
  });

  it("does not end at a `];` inside a line comment, a block comment or a string", () => {
    const src = 'const A = [\n  { id: "a" }, // was: keys: ["x"];\n  /* legacy: ]; */\n  { id: "b", label: "close ];" },\n  { id: "c", label: \'x]\' },\n];\nconst B = [];';
    expect(body(src)).toContain('{ id: "c"');
    expect(body(src).endsWith("},\n]")).toBe(true);
  });

  it("skips escaped quotes inside strings and backtick strings", () => {
    expect(body('const A = ["a\\"]", `t]`, "b"];')).toBe('["a\\"]", `t]`, "b"]');
  });

  it("reads the Rust contract mirror's `&[(...)]` shape", () => {
    const src = 'const X: &[(&str, &str)] = &[\n    ("new", "CmdOrCtrl+N"), // ]\n    ("open", "CmdOrCtrl+O"),\n];\nconst Y = &[];';
    expect(body(src, "rust")).toBe('[\n    ("new", "CmdOrCtrl+N"), // ]\n    ("open", "CmdOrCtrl+O"),\n]');
  });

  // R2 #136 — a `/…/` regex is not division and its brackets are not the array's.
  it("does not let a TS regex literal's brackets or comment-shaped text end the array", () => {
    expect(body('const A = [/[\\]]/, /a\\/\\/b]/, "z"];')).toBe('[/[\\]]/, /a\\/\\/b]/, "z"]');
  });

  // R2 #139 — a template nested inside `${…}` of another template.
  it("balances templates nested inside an interpolation", () => {
    expect(body("const A = [`a${[`]`].length}b`, 1];")).toBe("[`a${[`]`].length}b`, 1]");
  });

  // R2 #138 — Rust block comments NEST; the first `*/` does not close the outer one.
  it("keeps a nested Rust block comment closed until its own terminator", () => {
    const src = 'const X = &[\n    /* outer /* inner */ still comment ] */\n    ("a", "b"),\n];';
    expect(body(src, "rust")).toBe('[\n    /* outer /* inner */ still comment ] */\n    ("a", "b"),\n]');
  });

  // R2 #140 — a Rust raw string may hold an unescaped quote AND a bracket.
  it("reads through a Rust raw string that contains a quote and a bracket", () => {
    const src = 'const X = &[\n    ("a", r#"say "]" now"#),\n    ("b", "c"),\n];';
    expect(body(src, "rust")).toBe('[\n    ("a", r#"say "]" now"#),\n    ("b", "c"),\n]');
  });

  it("refuses an unknown lang rather than guessing a tokenizer", () => {
    expect(() => arrayLiteralEnd("[1]", 0, { lang: "python" })).toThrow(/unknown lang/);
  });

  it("returns -1 for an unterminated array, string or comment rather than a fragment", () => {
    expect(arrayLiteralEnd("[1, 2", 0)).toBe(-1);
    expect(arrayLiteralEnd('["a]', 0)).toBe(-1);
    expect(arrayLiteralEnd("[1, /* ] ", 0)).toBe(-1);
    expect(arrayLiteralEnd("[1, // ]", 0)).toBe(-1);
  });

  it("refuses an index that is not an opening bracket", () => {
    expect(() => arrayLiteralEnd("x[1]", 0)).toThrow(/not "\["/);
  });
});
