// @vitest-environment node
// WI-AL1.4 — The cosmetic pass reports the edits it applied: applying them to its input reproduces its output exactly, in every branch (none, full, entity-only) and above the verify limit (no edits).
import { describe, expect, it } from "vitest";
import { COSMETIC_VERIFY_LIMIT, applyCosmeticPassWithEdits, type CosmeticEdit } from "./serializerCosmetics";

function replay(markdown: string, edits: readonly CosmeticEdit[]): string {
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    expect(e.start).toBeGreaterThanOrEqual(cursor);
    out += markdown.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + markdown.slice(cursor);
}

describe("applyCosmeticPassWithEdits", () => {
  it.each([
    ["nothing to clean", "# Title\n\nplain text\n"],
    ["escapes stripped", "a \\[b\\] \\$c \\*d\\* e\\_f\n"],
    ["entity restored", "&#x20;lead and trail&#x20;\n"],
    ["escape inside code kept", "`\\[x\\]` and \\[y\\]\n"],
    ["CJK and emoji around escapes", "中文\\[注\\]😀\\_x\n"],
    ["block-start guard", "\\- not a list\n\n\\# not a heading\n"],
    ["empty", ""],
  ])("%s: the edits replay to the same text as the pass", (_name, markdown) => {
    const { text, edits } = applyCosmeticPassWithEdits(markdown);
    expect(replay(markdown, edits)).toBe(text);
    if (text === markdown) expect(edits).toEqual([]);
  });

  it("above the verify limit it changes nothing and reports no edit", () => {
    const big = `${"\\[x\\] ".repeat(Math.ceil(COSMETIC_VERIFY_LIMIT / 6) + 1)}\n`;
    expect(applyCosmeticPassWithEdits(big)).toEqual({ text: big, edits: [] });
  });
});
