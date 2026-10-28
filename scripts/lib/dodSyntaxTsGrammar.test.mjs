// The registration grammar `declaredTestCases` recognises: direct vitest
// calls through verified bindings, documented modifiers and table forms, and
// same-file helpers invoked in straight-line code. Every form outside it —
// fake iterators, stored or forwarded callbacks, parameter aliases,
// conditional, deferred or recursive invocation, shadowed or foreign roots,
// unknown modifiers — registers nothing, and says why.
import { describe, expect, it } from "vitest";
import { declaredTestCases, parseSource, testRoots } from "./dodSyntaxTs.mjs";

const count = (src) => declaredTestCases(parseSource("a.test.ts", src));
const lines = (...l) => `${l.join("\n")}\n`;
const LIVE = 'it("x", () => {})';

describe("registration outside the grammar contributes zero", () => {
  it.each([
    ["a fake map method that only stores its callback", lines("const callbacks = { map(f) { this.saved = f; } };", `callbacks.map(() => ${LIVE});`)],
    ["a fake forEach on an object", lines("const o = { forEach(f) {} };", `o.forEach(() => ${LIVE});`)],
    ["an iterator over an empty array literal", `[].forEach(() => ${LIVE});`],
    ["an iterator over a spread array", lines("const xs = [];", `[...xs].forEach(() => ${LIVE});`)],
    ["a callback stored in an array", lines("const saved = [];", `saved.push(() => ${LIVE});`)],
    ["a callback forwarded to another helper", lines("function run(f) { f(); }", "function forward(f) { run(f); }", `forward(() => ${LIVE});`)],
    ["a parameter alias", lines("function run(f) { const alias = f; alias(); }", `run(() => ${LIVE});`)],
    ["a callback invoked under if", lines("function run(f) { if (false) f(); }", `run(() => ${LIVE});`)],
    ["a registration under a module-level if", `if (false) { ${LIVE}; }`],
    ["a registration in an empty loop", `for (const n of []) { ${LIVE}; }`],
    ["a registration in a while loop", `while (false) { ${LIVE}; }`],
    ["a callback after an early return", lines("function run(f) { return; f(); }", `run(() => ${LIVE});`)],
    ["a callback after a conditional return", lines("function run(f, c) { if (c) return; f(); }", `run(() => ${LIVE}, true);`)],
    ["a callback after a throw", lines("function run(f) { throw new Error(); f(); }", `run(() => ${LIVE});`)],
    ["a deferred callback", `setTimeout(() => ${LIVE});`],
    ["a callback a helper wraps and returns", lines("function later(f) { return () => f(); }", `later(() => ${LIVE});`)],
    ["a callback queued as a microtask", lines("function run(f) { queueMicrotask(f); }", `run(() => ${LIVE});`)],
    ["recursive registration", lines(`function reg() { ${LIVE}; reg(); }`, "reg();")],
    ["mutually recursive registration", lines("function a() { b(); }", `function b() { a(); ${LIVE}; }`, "a();")],
    ["an it shadowed inside a suite", `describe("s", () => { const it = (t, f) => t; it("x", () => {}); });`],
    ["an it imported from another package", lines('import { it } from "node:test";', `${LIVE};`)],
    ["a test imported from playwright", lines('import { test } from "@playwright/test";', 'test("x", () => {});')],
    ["an it renamed on import", lines('import { test as it } from "vitest";', `${LIVE};`)],
    ["a reassigned let helper", lines(`let reg = () => { ${LIVE}; };`, "reg = () => {};", "reg();")],
    ["a reassigned function declaration", lines(`function reg() { ${LIVE}; }`, "reg = () => {};", "reg();")],
    ["an unknown modifier", 'it.foo("x", () => {});'],
    ["a modifier after a table", 'it.each([1]).only("x %s", () => {});'],
    ["a case modifier on a suite", 'describe.fails("s", () => { it("x", () => {}); });'],
    ["a suite modifier on a case", 'it.shuffle("x", () => {});'],
    ["an optional call", 'it?.("x", () => {});'],
    ["a registration passed as an argument", `void [${LIVE}];`],
    ["a case under skipIf(true)", 'it.skipIf(true)("x", () => {});'],
    ["a case under runIf(false)", 'it.runIf(false)("x", () => {});'],
    ["a case over an empty table", 'it.each([])("x %s", () => {});'],
    ["a case over an empty for table", 'test.for([])("x %s", () => {});'],
    ["a suite under skipIf(true)", `describe.skipIf(true)("s", () => { ${LIVE}; });`],
    ["a suite over an empty table", `describe.each([])("s %s", () => { ${LIVE}; });`],
    ["a case under a non-literal skipIf", 'it.skipIf(process.env.CI)("x", () => {});'],
    ["a case under a non-literal runIf", 'it.runIf(hasThing)("x", () => {});'],
    ["a reassigned callback parameter", lines("function run(f) { f = () => {}; f(); }", `run(() => ${LIVE});`)],
    ["a callback parameter reassigned by destructuring", lines("function run(f) { ({ f } = { f: () => {} }); f(); }", `run(() => ${LIVE});`)],
    ["a helper reassigned by object destructuring", lines(`function reg() { ${LIVE}; }`, "({ reg } = { reg: () => {} });", "reg();")],
    ["a helper reassigned by renamed destructuring", lines(`function reg() { ${LIVE}; }`, "({ other: reg } = { other: () => {} });", "reg();")],
    ["a helper reassigned by array destructuring", lines(`function reg() { ${LIVE}; }`, "[reg] = [() => {}];", "reg();")],
    ["a helper reassigned by a for-of head", lines(`function reg() { ${LIVE}; }`, "for (reg of [() => {}]) {}", "reg();")],
  ])("refuses %s", (_form, src) => {
    expect(count(src)).toBe(0);
  });
});

describe("registration inside the grammar counts", () => {
  it.each([
    ["a global it", `${LIVE};`],
    ["an it imported from vitest", lines('import { it } from "vitest";', `${LIVE};`)],
    ["an awaited helper", lines(`async function reg() { ${LIVE}; }`, "await reg();")],
    ["a helper whose result is bound", lines(`function setup() { ${LIVE}; return 1; }`, "const ctx = setup();")],
    ["a callback a helper invokes in straight-line code", lines("function run(f) { f(); }", `run(() => ${LIVE});`)],
    ["a callback a helper hands to an array literal's forEach", lines("function run(f) { [1].forEach(f); }", `run(() => ${LIVE});`)],
    ["an array literal's map", `[1, 2].map(() => ${LIVE});`],
    ["a suite callback named by a const", lines(`const body = () => { ${LIVE}; };`, 'describe("s", body);')],
    ["a nested suite with options", `describe("s", { timeout: 1 }, () => { describe("t", () => { ${LIVE}; }); });`],
  ])("counts %s", (_form, src) => {
    expect(count(src)).toBe(1);
  });

  it.each([
    "only", "concurrent", "sequential", "fails",
  ])("counts it.%s", (mod) => {
    expect(count(`it.${mod}("x", () => {});`)).toBe(1);
    expect(count(`test.${mod}("x", () => {});`)).toBe(1);
  });

  it.each(["only", "concurrent", "sequential", "shuffle"])("counts a case under describe.%s", (mod) => {
    expect(count(`describe.${mod}("s", () => { ${LIVE}; });`)).toBe(1);
  });

  it("counts the documented table and condition forms", () => {
    expect(count('it.each([1])("x %s", () => {});')).toBe(1);
    expect(count('test.for([1])("x %s", () => {});')).toBe(1);
    expect(count('it.concurrent.each([1])("x %s", () => {});')).toBe(1);
    expect(count('it.runIf(true)("x", () => {});')).toBe(1);
    expect(count(`describe.each([1])("s %s", () => { ${LIVE}; });`)).toBe(1);
    expect(count(`describe.skipIf(false)("s", () => { ${LIVE}; });`)).toBe(1);
    expect(count('it.skipIf(false)("x", () => {});')).toBe(1);
    expect(count('it.runIf(!false)("x", () => {});')).toBe(1);
  });

  it("an independent supported case still counts beside an unsupported one", () => {
    expect(count(lines(`if (false) { ${LIVE}; }`, 'it("y", () => {});'))).toBe(1);
  });
});

describe("unsupported forms are explained", () => {
  it.each([
    ["a statement that is not straight-line", `if (false) { ${LIVE}; }`, /if statement/i],
    ["a forwarded callback", lines("function run(f) { f(); }", "function forward(f) { run(f); }", `forward(() => ${LIVE});`), /forward/i],
    ["an unresolved callee", `setTimeout(() => ${LIVE});`, /setTimeout/],
    ["recursion", lines(`function reg() { ${LIVE}; reg(); }`, "reg();"), /recursi/i],
    ["an unknown modifier", 'it.foo("x", () => {});', /modifier/i],
    ["a callback a helper invokes only under if", lines("function run(f) { if (false) f(); }", `run(() => ${LIVE});`), /not invoked in straight-line code/],
    ["a callback a helper only aliases", lines("function run(f) { const alias = f; alias(); }", `run(() => ${LIVE});`), /not invoked in straight-line code/],
    ["a reassigned callback parameter", lines("function run(f) { f = () => {}; f(); }", `run(() => ${LIVE});`), /written outside its declaration/],
    ["a helper reassigned by destructuring", lines(`function reg() { ${LIVE}; }`, "({ reg } = { reg: () => {} });", "reg();"), /written outside its declaration/],
    ["a let helper", lines(`let reg = () => { ${LIVE}; };`, "reg();"), /`reg`.*let/],
    ["a non-literal skipIf", 'it.skipIf(process.env.CI)("x", () => {});', /skipIf.*not a literal/],
  ])("names %s", (_form, src, reason) => {
    const { unsupported } = testRoots(parseSource("a.test.ts", src));
    expect(unsupported.map((u) => u.reason).join("\n")).toMatch(reason);
  });
});
