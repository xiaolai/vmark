// @vitest-environment node
// Blank-line preservation across the WYSIWYG round trip.
// Plan: dev-docs/plans/20260721-blank-line-preservation.md (WI-1.2, WI-1.3, WI-1.4)
//
// Root cause (verified): blank-line runs between blocks survive markdown parsing
// (MDAST positions) but are dropped by the MDAST→PM→MDAST adapter, which builds
// positionless MDAST on the way back. This suite pins the fix: capture the gap
// into a nullable `blankLinesBefore` PM attribute (always), and emit it only when
// preserveBlankLines is on (default off ⇒ legacy output byte-identical).
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { testSchema } from "../testSchema";

function firstTwoBlocks(md: string) {
  const doc = parseMarkdown(testSchema, md);
  return [doc.child(0), doc.child(1)] as const;
}

describe("blank-line capture (unconditional, ADR-4)", () => {
  it("captures a >1 blank-line run as blankLinesBefore on the following block", () => {
    const [, second] = firstTwoBlocks("A\n\n\n\nB\n"); // 3 blank lines between A and B
    expect(second.attrs.blankLinesBefore).toBe(3);
  });

  it("leaves the normal single blank line as null (inherit default)", () => {
    const [, second] = firstTwoBlocks("A\n\nB\n"); // 1 blank line — the default
    expect(second.attrs.blankLinesBefore).toBeNull();
  });

  it("clamps a very large run to the max (10)", () => {
    const many = "A\n" + "\n".repeat(30) + "B\n";
    const [, second] = firstTwoBlocks(many);
    expect(second.attrs.blankLinesBefore).toBe(10);
  });
});

describe("blank-line emit (gated on preserveBlankLines, ADR-1/1a)", () => {
  it("preserves a >1 blank-line run round trip when enabled", () => {
    const src = "A\n\n\n\nB\n";
    const doc = parseMarkdown(testSchema, src);
    expect(serializeMarkdown(testSchema, doc, { preserveBlankLines: true })).toBe(src);
  });

  it("collapses to legacy output when disabled (default) — byte-identical", () => {
    const doc = parseMarkdown(testSchema, "A\n\n\n\nB\n");
    expect(serializeMarkdown(testSchema, doc)).toBe("A\n\nB\n");
  });

  it("is idempotent: serialize twice yields the same output (enabled)", () => {
    const doc1 = parseMarkdown(testSchema, "A\n\n\n\nB\n");
    const out1 = serializeMarkdown(testSchema, doc1, { preserveBlankLines: true });
    const doc2 = parseMarkdown(testSchema, out1);
    const out2 = serializeMarkdown(testSchema, doc2, { preserveBlankLines: true });
    expect(out2).toBe(out1);
  });
});

describe("does not corrupt lists (SC5)", () => {
  it("keeps a tight list tight and round-trips a mixed doc when enabled", () => {
    const src = "- one\n- two\n\n\n\nAfter\n";
    const doc = parseMarkdown(testSchema, src);
    const out = serializeMarkdown(testSchema, doc, { preserveBlankLines: true });
    // The tight list must not gain blank lines between its items.
    expect(out).toContain("- one\n- two");
    // The >1 blank run before the trailing paragraph is preserved.
    expect(out).toContain("- two\n\n\n\nAfter");
  });
});
