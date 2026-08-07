// @vitest-environment node
/**
 * Tests for caseTransformations — Unicode-aware case transforms.
 * ASCII behavior is also locked in via textTransformations.test.ts
 * (this module is re-exported there); this file focuses on the
 * non-ASCII paths.
 */

import { describe, expect, it } from "vitest";
import { toggleCase } from "./caseTransformations";

describe("toggleCase — Unicode awareness", () => {
  it("uppercases all-lowercase Cyrillic", () => {
    // Regression (Codex audit): ASCII-only counting saw 0 upper / 0 lower
    // and always took the lowercase branch, leaving this unchanged.
    expect(toggleCase("привет")).toBe("ПРИВЕТ");
  });

  it("lowercases all-uppercase Cyrillic", () => {
    expect(toggleCase("ПРИВЕТ")).toBe("привет");
  });

  it("uppercases mostly-lowercase Cyrillic with some uppercase", () => {
    expect(toggleCase("приВет")).toBe("ПРИВЕТ");
  });

  it("uppercases all-lowercase Greek", () => {
    expect(toggleCase("καλημέρα")).toBe("ΚΑΛΗΜΈΡΑ");
  });

  it("uppercases accented Latin text", () => {
    expect(toggleCase("café au lait")).toBe("CAFÉ AU LAIT");
  });

  it("lowercases accented uppercase Latin text", () => {
    expect(toggleCase("ÉTAT MAJOR")).toBe("état major");
  });

  it("counts accented letters, not just ASCII, when deciding direction", () => {
    // "éÉÀ" — 1 lower, 2 upper → lowercase branch.
    expect(toggleCase("éÉÀ")).toBe("ééà");
  });

  it("ignores caseless characters (CJK, digits, punctuation) when counting", () => {
    expect(toggleCase("中文 abc 123")).toBe("中文 ABC 123");
    expect(toggleCase("中文 ABC 123")).toBe("中文 abc 123");
  });

  it("leaves fully caseless text unchanged (lowercase branch is a no-op)", () => {
    expect(toggleCase("中文 123 !?")).toBe("中文 123 !?");
  });

  it("handles empty string", () => {
    expect(toggleCase("")).toBe("");
  });
});
