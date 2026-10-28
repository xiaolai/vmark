// @vitest-environment node
// WI-AL1.7 — the shared journal reply validators: a decimal u64 is canonical (no padding, no sign) and bounded by 2^64 - 1, so a generation or sequence number past the u64 range is malformed, never trusted; a wire timestamp is a whole, nonnegative millisecond count inside the JavaScript Date range, so formatting it can never throw
import { describe, it, expect } from "vitest";

import { isDecimal, isEpochMillis } from "../journalIpc";

describe("isDecimal", () => {
  it.each(["0", "1", "42", "9007199254740993", "18446744073709551615"])("accepts %s", (v) => {
    expect(isDecimal(v)).toBe(true);
  });

  it.each([
    ["one past u64::MAX", "18446744073709551616"],
    ["a 21-digit value", "100000000000000000000"],
    ["a padded value", "01"],
    ["an empty string", ""],
    ["a sign", "-1"],
    ["a fraction", "1.5"],
    ["full-width digits", "１２"],
    ["a number", 1],
    ["null", null],
  ])("refuses %s", (_label, v) => {
    expect(isDecimal(v)).toBe(false);
  });
});

describe("isEpochMillis", () => {
  it.each([0, 1_760_000_000_000, 8.64e15])("accepts %s", (v) => {
    expect(isEpochMillis(v)).toBe(true);
    expect(() => new Date(v).toISOString()).not.toThrow();
  });

  it.each([
    ["a negative time", -1],
    ["a fractional time", 1.5],
    ["one past the Date range", 8.64e15 + 1],
    ["an unsafe integer", 2 ** 60],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a string", "1"],
  ])("refuses %s", (_label, v) => {
    expect(isEpochMillis(v)).toBe(false);
  });
});
