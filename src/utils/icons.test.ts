import { describe, it, expect } from "vitest";
import { icons } from "./icons";

describe("icons registry", () => {
  it("freezes the public registry to prevent accidental override", () => {
    expect(Object.isFrozen(icons)).toBe(true);
  });

  it("validates every icon as wellformed <svg>", () => {
    // The registry is built via defineIconSvg at module load; if any value
    // fails validation the module would have thrown before this test runs.
    // Sanity-check a few well-known icons match the structural contract.
    const samples: ReadonlyArray<keyof typeof icons> = [
      "heading",
      "bold",
      "italic",
      "sparkles",
    ];
    for (const key of samples) {
      const value = icons[key];
      expect(value.startsWith("<svg")).toBe(true);
      expect(value.endsWith("</svg>")).toBe(true);
      expect(/<script\b/i.test(value)).toBe(false);
      expect(/on[a-z]+\s*=/i.test(value)).toBe(false);
      expect(/javascript:/i.test(value)).toBe(false);
    }
  });

  it("includes the expected core icon set", () => {
    // Guard against accidental deletion of icons the toolbar depends on.
    for (const key of [
      "heading",
      "bold",
      "italic",
      "link",
      "image",
      "table",
      "sparkles",
      "chevronDown",
    ] as const) {
      expect(icons).toHaveProperty(key);
    }
  });
});
