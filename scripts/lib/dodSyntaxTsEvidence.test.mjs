// Evidence traversal for `--test-reach` in TypeScript: READING a fixture value
// keeps its text, but a function body counts only when executed code CALLS it
// by a uniquely resolved plain name. A function merely mentioned, stored or
// declared and never called keeps none of its text — even when it sits inside
// an otherwise accepted root.
import { describe, expect, it } from "vitest";
import { tsTestReach } from "./dodSyntaxReach.mjs";
import { parseSource } from "./dodSyntaxTs.mjs";

const reach = (...l) => {
  const src = `${l.join("\n")}\n`;
  return tsTestReach(parseSource("a.test.ts", src), src);
};
const S = '"DOD_SENTINEL"';
const HELPER = `function helper() { return ${S}; }`;

describe("an uninvoked body contributes no evidence", () => {
  it.each([
    ["a helper only stored in a const", [`function helper() { return ${S}; }`, 'it("t", () => { const stored = helper; void stored; });']],
    ["an unused arrow nested in a real test", [`it("t", () => { const unused = () => ${S}; void 0; });`]],
    ["an unused function declared in a real test", [`it("t", () => { function unused() { return ${S}; } });`]],
    ["an unused arrow nested in a called helper", [`function helper() { const inner = () => ${S}; return 1; }`, 'it("t", () => { helper(); });']],
    ["a method of a fixture object", [`const fx = { run() { return ${S}; } };`, 'it("t", () => { void fx; });']],
    ["a callback handed to an unknown callee", ['it("t", () => { later(() => ' + S + "); });"]],
    ["a callback pushed into storage", ['it("t", () => { const cbs = []; cbs.push(() => ' + S + "); });"]],
    ["a helper reached only through a method call", [`const fx = { run: () => ${S} };`, 'it("t", () => { fx.run(); });']],
    ["a reassigned helper", [`let helper = () => ${S};`, "helper = () => 0;", 'it("t", () => { helper(); });']],
    ["a hook of a suite with no runnable case", [`describe("s", () => { beforeEach(() => { void ${S}; }); });`, 'it("t", () => {});']],
    ["a helper called under if (false)", [HELPER, 'it("t", () => { if (false) helper(); });']],
    ["a helper called in the else of if (true)", [HELPER, 'it("t", () => { if (true) {} else { helper(); } });']],
    ["a helper called after a return", [HELPER, 'it("t", () => { return; helper(); });']],
    ["a helper called after a nested return", [HELPER, 'it("t", () => { { return; } helper(); });']],
    ["a helper called after a throw", [HELPER, 'it("t", () => { throw new Error(); helper(); });']],
    ["a helper called after an if whose branches both return", [HELPER, 'it("t", () => { if (x) { return; } else { return; } helper(); });']],
    ["a helper called on the dead side of &&", [HELPER, 'it("t", () => { false && helper(); });']],
    ["a helper called on the dead side of ||", [HELPER, 'it("t", () => { true || helper(); });']],
    ["a helper called on the dead side of a ternary", [HELPER, 'it("t", () => { void (0 ? helper() : 1); });']],
    ["a helper called in while (false)", [HELPER, 'it("t", () => { while (false) helper(); });']],
    ["a helper called over an empty array literal", [HELPER, 'it("t", () => { for (const x of []) helper(); });']],
    ["text after a return", ['it("t", () => { return; void ' + S + "; });"]],
    ["a dead call inside a called helper", [HELPER, "function outer() { return 1; helper(); }", 'it("t", () => { outer(); });']],
    ["a helper in the update clause of for (; false; …)", [HELPER, 'it("t", () => { for (; false; helper()) {} });']],
    ["a hoisted var whose initializer is dead", [HELPER, 'it("t", () => { if (false) { var x = helper(); } void x; });']],
    ["a hoisted var read before a return and initialized after it", ['it("t", () => { void x; return; var x = ' + S + "; });"]],
    ["a table row's callback the case never calls", [`it.each([["a", () => ${S}]])("t %s", (_n, f) => { void f; });`]],
    ["a table row's callback called only under if (false)", [`it.each([["a", () => ${S}]])("t %s", (_n, f) => { if (false) f(); });`]],
    ["a table row's callback through a reassigned parameter", [`it.each([["a", () => ${S}]])("t %s", (_n, f) => { f = () => 0; f(); });`]],
    ["a table row's callback called only in a nested uncalled arrow", [`it.each([["a", () => ${S}]])("t %s", (_n, f) => { const g = () => f(); void g; });`]],
    ["a table row's callback at another position than the one called", [`it.each([[() => ${S}, () => 0]])("t %s", (f, g) => { g(); });`]],
    ["a callback a called helper never invokes", ["function run(f) { return f; }", `it("t", () => { run(() => ${S}); });`]],
    ["a callback a called helper invokes only under if (false)", ["function run(f) { if (false) f(); }", `it("t", () => { run(() => ${S}); });`]],
    ["a callback through a helper's reassigned parameter", ["function run(f) { f = () => 0; f(); }", `it("t", () => { run(() => ${S}); });`]],
    ["a callback passed where the helper calls another parameter", ["function run(f, g) { g(); }", `it("t", () => { run(() => ${S}, () => 0); });`]],
    ["a callback passed to a helper only from code that never runs", ["function run(f) { f(); }", `function unused() { run(() => ${S}); }`, 'it("t", () => { run(() => 0); });']],
  ])("drops %s", (_form, src) => {
    expect(reach(...src)).not.toContain("DOD_SENTINEL");
  });
});

describe("executed and read code is evidence", () => {
  it.each([
    ["a helper the test calls", [`function helper() { return ${S}; }`, 'it("t", () => { helper(); });']],
    ["a nested arrow the test calls", [`it("t", () => { const used = () => ${S}; used(); });`]],
    ["an IIFE in the test", [`it("t", () => { (() => ${S})(); });`]],
    ["a fixture value the test reads", [`const fx = ${S};`, 'it("t", () => { void fx; });']],
    ["a destructured fixture", [`const { a } = { a: ${S} };`, 'it("t", () => { void a; });']],
    ["a value read through a called helper", [`const fx = ${S};`, "const make = () => fx;", 'it("t", () => { make(); });']],
    ["a table", [`it.each([[${S}]])("t %s", () => {});`]],
    ["a hook body", [`beforeEach(() => { void ${S}; });`, 'it("t", () => {});']],
    ["a handler named by a const", [`const handler = () => { void ${S}; };`, 'it("t", handler);']],
    ["a handler a helper registers for its caller", ["function reg(f) { it(\"t\", f); }", `reg(() => { void ${S}; });`]],
    ["a helper called under a condition that may hold", [HELPER, 'it("t", () => { if (process.env.X) helper(); });']],
    ["a helper called in the live branch of if (true)", [HELPER, 'it("t", () => { if (true) helper(); });']],
    ["a helper called before a return", [HELPER, 'it("t", () => { helper(); return; });']],
    ["a table row's callback the case calls by its parameter", [`it.each([["a", () => ${S}]])("t %s", (_n, f) => { f(); });`]],
    ["a table row's helper the case calls by its parameter", [HELPER, 'it.each([["a", helper]])("t %s", (_n, f) => { f(); });']],
    ["a single-value row's callback the case calls", [`it.each([() => ${S}])("t", (f) => { f(); });`]],
    ["a callback a called helper invokes through its parameter", ["function run(f) { return f(); }", `it("t", () => { run(() => ${S}); });`]],
    ["an edit callback a const helper applies", ["const drifted = (k, edit) => edit(k);", `it("t", () => { drifted("k", (s) => s + ${S}); });`]],
  ])("keeps %s", (_form, src) => {
    expect(reach(...src)).toContain("DOD_SENTINEL");
  });
});
