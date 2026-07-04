/**
 * Tests for the barrel-purity classifier used by scripts/check-index-barrels.mjs
 * (the guard behind vitest.config.ts's `**\/index.ts` coverage exclusion).
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { findImpureStatements } from "./check-index-barrels.mjs";

function impure(source: string): string[] {
  return findImpureStatements(source) as string[];
}

describe("findImpureStatements — pure barrels", () => {
  it.each<[string, string]>([
    ["named re-export", 'export { Foo, Bar } from "./foo";'],
    ["star re-export", 'export * from "./foo";'],
    ["namespaced star re-export", 'export * as foo from "./foo";'],
    ["type re-export", 'export type { Foo } from "./foo";'],
    ["import then re-export", 'import { foo } from "./foo";\nexport { foo };'],
    ["type-only import", 'import type { Foo } from "./foo";\nexport type { Foo };'],
    ["type alias", "export type Id = string;"],
    ["generic type alias", "export type Box<T> = { value: T };"],
    ["interface", "export interface Props { id: string; }"],
    ["comments and blank lines only", "// header\n\n/* block */\n"],
    [
      "multi-line export list",
      'export {\n  A,\n  B,\n  type C,\n} from "./mod";\nexport * from "./other";',
    ],
  ])("%s is pure", (_name, source) => {
    expect(impure(source)).toEqual([]);
  });
});

describe("findImpureStatements — logic detection", () => {
  it.each<[string, string]>([
    ["const with initializer", 'export const themes = { a: 1 };'],
    ["function declaration", "export function make() { return 1; }"],
    ["class declaration", "export class Store {}"],
    ["side-effect call", 'import { init } from "./init";\ninit();'],
    ["default export of expression", "export default { a: 1 };"],
    ["top-level control flow", "if (import.meta.env.DEV) { console.log('x'); }"],
  ])("%s is flagged", (_name, source) => {
    expect(impure(source).length).toBeGreaterThan(0);
  });

  it("does not get fooled by keywords inside comments or strings", () => {
    const source = [
      "// export const notReal = 1;",
      "/* const alsoNotReal = () => {}; */",
      'export { name } from "./const-function-if";',
    ].join("\n");
    expect(impure(source)).toEqual([]);
  });

  it.each<[string, string]>([
    [
      "semicolonless star re-export followed by logic",
      'export * from "./a"\nconst x = compute()',
    ],
    [
      "semicolonless named re-export followed by side effect",
      'export { a } from "./a"\nconsole.log("boot")',
    ],
    [
      "semicolonless import followed by call",
      'import { init } from "./init"\ninit()',
    ],
  ])("%s is flagged despite missing semicolons", (_name, source) => {
    expect(impure(source).length).toBeGreaterThan(0);
  });

  it.each<[string, string]>([
    ["dynamic import call", 'import("./side-effect")'],
    ["import.meta expression", 'import.meta.env.DEV && console.log("x")'],
  ])("%s is flagged (import-prefixed runtime logic)", (_name, source) => {
    expect(impure(source).length).toBeGreaterThan(0);
  });

  it("side-effect and type imports remain pure", () => {
    expect(impure('import "./polyfill";\nimport type { T } from "./t";')).toEqual([]);
  });

  it("brackets inside module-specifier strings cannot mask following logic", () => {
    // "({" inside the specifier must not skew depth tracking and turn the
    // next line into a "continuation" the classifier skips.
    const source = ['import { a } from "./weird({name"', "const hack = doEvil()"].join("\n");
    expect(impure(source).length).toBeGreaterThan(0);
  });

  it("specifiers containing brackets are themselves still pure", () => {
    expect(impure('export * from "./odd({[dir"')).toEqual([]);
  });

  it("semicolonless multi-line re-exports stay pure", () => {
    const source = [
      "export {",
      "  A,",
      "  B,",
      '} from "./mod"',
      'export * from "./other"',
      'import { x } from "./x"',
      "export { x }",
    ].join("\n");
    expect(impure(source)).toEqual([]);
  });

  it("flags logic even when preceded by pure statements", () => {
    const source = [
      'export * from "./pure";',
      "export const sneak = compute();",
    ].join("\n");
    const result = impure(source);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("sneak");
  });
});
