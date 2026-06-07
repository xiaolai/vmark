// RW-1 (L5) — errorMessage helper unit test
/**
 * Tests for the errorMessage helper.
 */

import { describe, it, expect } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the message of a custom Error subclass", () => {
    class CustomError extends Error {}
    expect(errorMessage(new CustomError("custom failure"))).toBe(
      "custom failure"
    );
  });

  it("returns a plain string unchanged", () => {
    expect(errorMessage("just a string")).toBe("just a string");
  });

  it("stringifies a number", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("stringifies a plain object via String()", () => {
    expect(errorMessage({ foo: "bar" })).toBe("[object Object]");
  });

  it("stringifies null", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("uses String() — not duck-typing — for a non-Error object with a message property", () => {
    // Proves instanceof check: a plain object exposing `message` is NOT
    // treated as an Error, so its `.message` is ignored in favor of String().
    expect(errorMessage({ message: "fake error" })).toBe("[object Object]");
  });
});
