// @vitest-environment node
/**
 * Character classes for the terminal IME layer.
 *
 * The ASCII / non-ASCII split decides whether the gate treats an insert as
 * IME-origin text or as something xterm's keydown path already handled.
 */
import { describe, it, expect } from "vitest";
import { ALL_ASCII_RE, NON_ASCII_RE } from "./imeCharClass";

describe("ASCII detectors", () => {
  it.each(["你", "。", "？", "a你"])("NON_ASCII_RE matches %s", (s) => {
    expect(NON_ASCII_RE.test(s)).toBe(true);
  });

  it.each(["a", "/", "abc", "1"])("NON_ASCII_RE does not match %s", (s) => {
    expect(NON_ASCII_RE.test(s)).toBe(false);
  });

  it.each(["a", "/", "abc"])("ALL_ASCII_RE matches %s", (s) => {
    expect(ALL_ASCII_RE.test(s)).toBe(true);
  });

  it.each(["你", "a你", ""])("ALL_ASCII_RE does not match %j", (s) => {
    expect(ALL_ASCII_RE.test(s)).toBe(false);
  });
});
