// The cases a test file REGISTERS: only straight-line module code, suite
// callbacks and the helpers that registration code invokes are walked, so a
// test inside an uncalled function, a test handler, a hook, a loop or an if
// never counts.
import { describe, expect, it } from "vitest";
import { declaredTestCases, parseSource, testRoots } from "./dodSyntaxTs.mjs";

const count = (src, opts) => declaredTestCases(parseSource("a.test.ts", src), opts);
const lines = (...l) => `${l.join("\n")}\n`;

describe("declaredTestCases counts only what registration code reaches", () => {
  it.each([
    ["an uncalled function declaration", 'function dead() { it("x", () => {}); }'],
    ["an uncalled arrow bound to a const", 'const unused = () => { it("x", () => {}); };'],
    ["an uncalled function expression", 'const unused = function () { describe("s", () => { it("x", () => {}); }); };'],
    ["a hook body", 'beforeAll(() => { it("x", () => {}); });'],
    ["a class method", 'class K { m() { it("x", () => {}); } }'],
    ["an uncalled helper inside a suite", 'describe("s", () => { function dead() { it("x", () => {}); } });'],
    ["a helper only a skipped suite invokes", lines('function reg() { it("x", () => {}); }', 'describe.skip("s", () => { reg(); });')],
    ["a callback only stored, never invoked", lines("const callbacks = [];", 'callbacks.push(() => it("dead", () => {}));')],
    ["a named helper only stored, never invoked", lines('function reg() { it("x", () => {}); }', "const callbacks = [];", "callbacks.push(reg);")],
    ["a callback handed to a local helper that only stores it", lines("const saved = [];", "function keep(f) { saved.push(f); }", 'keep(() => { it("x", () => {}); });')],
    ["a callback a local helper defers inside a function it never runs", lines("function later(f) { return () => f(); }", 'later(() => { it("x", () => {}); });')],
    ["a module-level loop", 'for (const n of [1]) { it(`x${n}`, () => {}); }'],
    ["a module-level if", 'if (true) { describe("s", () => { it("y", () => {}); }); }'],
  ])("refuses a case in %s", (_where, src) => {
    expect(count(src)).toBe(0);
  });

  it("counts a case nested in another case's handler once — the outer one", () => {
    const src = 'it("outer", () => { it("inner", () => {}); });\n';
    expect(count(src)).toBe(1);
    expect(count(src, { titleIncludes: "inner" })).toBe(0);
  });

  it.each([
    ["a helper invoked at module level", lines('function register() { it("a", () => {}); }', "register();")],
    ["a helper passed by name to forEach", lines('const register = (n) => it(`c${n}`, () => {});', "[1, 2].forEach(register);")],
    ["an inline forEach callback", '[1].forEach((n) => { it(`x${n}`, () => {}); });'],
    ["an IIFE", '(() => { it("x", () => {}); })();'],
    ["a suite whose callback is a named function", lines('describe("s", suiteBody);', 'function suiteBody() { it("x", () => {}); }')],
    ["a helper invoked from a suite callback", lines('const reg = () => { it("x", () => {}); };', 'describe("s", () => { reg(); });')],
    ["an awaited, exported helper invoked at module level", lines('export async function reg() { it("x", () => {}); }', "await reg();")],
    ["a const alias of a helper", lines('function register() { it("a", () => {}); }', "const alias = register;", "alias();")],
    ["an alias of an alias of an arrow", lines('const reg = () => { it("a", () => {}); };', "const a = reg;", "const b = (a);", "b();")],
    ["an aliased helper passed to forEach", lines('const reg = (n) => it(`c${n}`, () => {});', "const alias = reg;", "[1].forEach(alias);")],
    ["a callback a local helper invokes", lines("function each(f) { f(1); }", 'each((n) => { it(`x${n}`, () => {}); });')],
    ["a callback a local helper hands to forEach", lines("function each(f) { [1].forEach(f); }", 'each((n) => { it(`x${n}`, () => {}); });')],
    ["a map callback", '[1].map((n) => it(`x${n}`, () => {}));'],
  ])("counts a case registered through %s", (_how, src) => {
    expect(count(src)).toBe(1);
  });

  it("follows a helper by binding: a same-named inner function nothing calls is not it", () => {
    const src = lines(
      'function reg() { it("live", () => {}); }',
      'function outer() { function reg() { it("dead", () => {}); } return reg; }',
      "reg();",
    );
    expect(count(src)).toBe(1);
    expect(count(src, { titleIncludes: "dead" })).toBe(0);
  });

  it("terminates on a self-referential alias", () => {
    expect(count(lines("var a = b;", "var b = a;", "a();", 'it("x", () => {});'))).toBe(1);
  });

  it("terminates on mutually recursive helpers and counts none of their cases", () => {
    expect(count(lines("function a() { b(); }", 'function b() { a(); it("x", () => {}); }', "a();"))).toBe(0);
  });

  it("does not root the hooks of a dead helper", () => {
    const sf = parseSource("a.test.ts", lines('function dead() { beforeEach(() => {}); }', 'it("t", () => {});'));
    expect(testRoots(sf).hooks).toHaveLength(0);
  });

  it("an empty file registers nothing", () => {
    expect(testRoots(parseSource("a.test.ts", ""))).toEqual({ cases: [], suiteTitles: [], hooks: [], bodies: new Map(), unsupported: [] });
  });
});
