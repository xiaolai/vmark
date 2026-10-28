// @vitest-environment node
// validateChanges refuses a transaction the mapping arithmetic cannot carry exactly, as the Rust validator does: every coordinate a safe integer, and the resulting document at most 2^53-1 long
import { describe, expect, it } from "vitest";
import { validateChanges, type Section } from "../pieces";

const MAX = Number.MAX_SAFE_INTEGER;
const sec = (fromA: number, toA: number, fromB: number, toB: number): Section => ({ fromA, toA, fromB, toB });

describe("validateChanges", () => {
  it("keeps the sections that change something", () => {
    expect(validateChanges([sec(0, 0, 0, 0), sec(1, 2, 1, 4)], 3)).toEqual([sec(1, 2, 1, 4)]);
  });

  it("accepts a document grown exactly to 2^53-1", () => {
    expect(validateChanges([sec(0, 0, 0, MAX - 1)], 1)).toEqual([sec(0, 0, 0, MAX - 1)]);
  });

  it.each([
    ["an unsafe inserted end", [sec(0, 0, 0, 2 ** 53)], 0],
    ["an unsafe start and end", [sec(0, 0, 0, 2 ** 60)], 0],
    ["a growth past 2^53-1 after the last section", [sec(0, 0, 0, MAX - 1)], 2],
    ["an unsafe length", [sec(0, 0, 0, 1)], 2 ** 53],
  ] as const)("refuses %s", (_name, changes, lenB) => {
    expect(() => validateChanges(changes, lenB)).toThrow(/malformed transaction|longer than 2\^53-1|malformed length/);
  });
});
