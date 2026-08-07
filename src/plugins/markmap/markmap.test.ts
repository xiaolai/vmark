// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DEFAULT_MARKMAP_CONTENT } from "./constants";

describe("markmap constants", () => {
  it("default template starts with a heading", () => {
    expect(DEFAULT_MARKMAP_CONTENT.trim()).toMatch(/^# /);
  });

  it("default template contains sub-headings", () => {
    expect(DEFAULT_MARKMAP_CONTENT).toContain("## ");
    expect(DEFAULT_MARKMAP_CONTENT).toContain("### ");
  });

  it("default template is valid markdown", () => {
    const lines = DEFAULT_MARKMAP_CONTENT.trim().split("\n");
    const headingLines = lines.filter((l) => l.match(/^#{1,6} /));
    // At least 3 heading levels used
    expect(headingLines.length).toBeGreaterThanOrEqual(3);
  });
});
