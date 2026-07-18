/**
 * Tests for buildLineToBlockMap — mapping 1-based source-markdown lines
 * (as reported by the lint engine on the serialized document) to top-level
 * ProseMirror blocks.
 *
 * Line numbers are derived from the actual serializer output inside each
 * test, so the expectations track the real pipeline (blank separator lines,
 * code-fence lines, list-item lines) instead of hardcoding them.
 */

import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { buildLineToBlockMap } from "./lineMap";

function p(text: string): PMNode {
  return testSchema.node("paragraph", null, text ? [testSchema.text(text)] : []);
}

function code(text: string): PMNode {
  return testSchema.node("codeBlock", null, text ? [testSchema.text(text)] : []);
}

function doc(...blocks: PMNode[]): PMNode {
  return testSchema.node("doc", null, blocks);
}

/** 1-based line number of the first serialized line that equals `needle`. */
function lineOf(d: PMNode, needle: string): number {
  const lines = serializeMarkdown(testSchema, d).split("\n");
  const idx = lines.findIndex((l) => l === needle);
  expect(idx, `line "${needle}" should exist in serialization`).toBeGreaterThanOrEqual(0);
  return idx + 1;
}

describe("buildLineToBlockMap", () => {
  it("maps paragraphs to their true source lines, skipping blank separators", () => {
    const d = doc(p("alpha"), p("beta"));
    const map = buildLineToBlockMap(d);

    expect(map.get(lineOf(d, "alpha"))?.pos).toBe(0);
    expect(map.get(lineOf(d, "beta"))?.pos).toBe(d.child(0).nodeSize);
    // The blank separator line between the two blocks maps to nothing
    expect(lineOf(d, "beta")).toBeGreaterThan(lineOf(d, "alpha") + 1);
    expect(map.get(lineOf(d, "alpha") + 1)).toBeUndefined();
  });

  it("maps every line of a fenced code block (fences included) to the block", () => {
    const d = doc(p("intro"), code("line1\nline2\nline3"));
    const map = buildLineToBlockMap(d);
    const codePos = d.child(0).nodeSize;

    for (const needle of ["line1", "line2", "line3"]) {
      expect(map.get(lineOf(d, needle))?.pos).toBe(codePos);
    }
    // Fence lines belong to the code block too
    expect(map.get(lineOf(d, "line1") - 1)?.pos).toBe(codePos);
    expect(map.get(lineOf(d, "line3") + 1)?.pos).toBe(codePos);
    expect(map.get(lineOf(d, "intro"))?.pos).toBe(0);
  });

  it("offsets blocks following a code fence correctly", () => {
    const d = doc(p("intro"), code("a\nb"), p("after"));
    const map = buildLineToBlockMap(d);
    const afterPos = d.child(0).nodeSize + d.child(1).nodeSize;

    expect(map.get(lineOf(d, "after"))?.pos).toBe(afterPos);
    // "after" sits well past the compressed numbering (which would say line 3)
    expect(lineOf(d, "after")).toBeGreaterThan(5);
  });

  it("maps each list item line to the containing list block", () => {
    const item = (text: string) =>
      testSchema.node("listItem", null, [p(text)]);
    const list = testSchema.node("bulletList", null, [item("one"), item("two")]);
    const d = doc(list, p("tail"));
    const map = buildLineToBlockMap(d);

    const serialized = serializeMarkdown(testSchema, d);
    const lines = serialized.split("\n");
    const oneLine = lines.findIndex((l) => l.includes("one")) + 1;
    const twoLine = lines.findIndex((l) => l.includes("two")) + 1;

    expect(oneLine).toBeGreaterThan(0);
    expect(twoLine).toBeGreaterThan(0);
    expect(map.get(oneLine)?.pos).toBe(0);
    expect(map.get(twoLine)?.pos).toBe(0);
    expect(map.get(lineOf(d, "tail"))?.pos).toBe(d.child(0).nodeSize);
  });

  it("returns no mapping for line 0, negative, or past-the-end lines", () => {
    const d = doc(p("alpha"), p("beta"));
    const map = buildLineToBlockMap(d);

    expect(map.get(0)).toBeUndefined();
    expect(map.get(-1)).toBeUndefined();
    expect(map.get(99)).toBeUndefined();
  });

  it("returns an empty map for an empty document", () => {
    const d = doc(p(""));
    const map = buildLineToBlockMap(d);
    expect(map.size).toBe(0);
  });

  it("keeps positions exact for headings mixed with paragraphs", () => {
    const heading = testSchema.node("heading", { level: 2 }, [testSchema.text("Title")]);
    const d = doc(heading, p("body"));
    const map = buildLineToBlockMap(d);

    expect(map.get(lineOf(d, "## Title"))?.pos).toBe(0);
    expect(map.get(lineOf(d, "body"))?.pos).toBe(d.child(0).nodeSize);
  });
});
