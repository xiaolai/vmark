import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../linter";

describe("lintMarkdown", () => {
  it("returns empty array for valid markdown", () => {
    const result = lintMarkdown("# Hello\n\nThis is valid markdown.");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const result = lintMarkdown("");
    expect(result).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    const result = lintMarkdown("   \n  \n  ");
    expect(result).toEqual([]);
  });

  it("returns empty array for frontmatter-only document", () => {
    const result = lintMarkdown("---\ntitle: test\n---");
    expect(result).toEqual([]);
  });

  it("each diagnostic has a unique id", () => {
    // Once rules are added, this will catch id collisions
    const source = "# Title\n\n## Valid\n\nSome text.";
    const result = lintMarkdown(source);
    const ids = result.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles a 5000-line document without error", () => {
    // Behavioral, not a wall-clock budget: a bare `performance.now()` assertion
    // flakes under parallel CPU load (the work is fine, the clock isn't). A
    // catastrophic O(n²) regression still surfaces here via Vitest's per-test
    // timeout (the run hangs), and hard perf budgets live in the bench suite
    // (`pnpm bench`), which is built for CPU contention.
    const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1}`);
    lines[0] = "# Title";
    const source = lines.join("\n");
    const result = lintMarkdown(source);
    expect(Array.isArray(result)).toBe(true);
  });
});
