import { describe, it, expect } from "vitest";
import { NON_ASCII_RE, ALL_ASCII_RE } from "./imeCharClass";

describe("imeCharClass", () => {
  it("NON_ASCII_RE matches any non-ASCII code unit, not just '-' and U+FFFF (#910)", () => {
    expect(NON_ASCII_RE.test("。")).toBe(true);
    expect(NON_ASCII_RE.test("你好")).toBe(true);
    expect(NON_ASCII_RE.test("？")).toBe(true);
    expect(NON_ASCII_RE.test("abc")).toBe(false);
    expect(NON_ASCII_RE.test("a。b")).toBe(true);
  });

  it("ALL_ASCII_RE requires every char to be ASCII (and non-empty)", () => {
    expect(ALL_ASCII_RE.test("?")).toBe(true);
    expect(ALL_ASCII_RE.test("hello")).toBe(true);
    expect(ALL_ASCII_RE.test("")).toBe(false);
    expect(ALL_ASCII_RE.test("？")).toBe(false);
    expect(ALL_ASCII_RE.test("a。")).toBe(false);
  });
});
