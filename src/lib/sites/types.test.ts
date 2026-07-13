// Site plugin type contracts (ADR-S1/S2/S3) — the validation vocabulary must be
// immutable at runtime, not merely `as const` at compile time.
import { describe, expect, it } from "vitest";
import { SITE_CAPABILITIES } from "./types";

describe("SITE_CAPABILITIES", () => {
  it("lists exactly the supported capabilities", () => {
    expect([...SITE_CAPABILITIES]).toEqual(["read", "publish"]);
  });

  it("is frozen so the validation vocabulary cannot be mutated before registry init", () => {
    expect(Object.isFrozen(SITE_CAPABILITIES)).toBe(true);
    expect(() => {
      (SITE_CAPABILITIES as unknown as string[]).push("delete");
    }).toThrow(TypeError);
    expect([...SITE_CAPABILITIES]).toEqual(["read", "publish"]);
  });
});
