/**
 * Tests for footnoteEditOps — pure helpers behind footnote popup save/delete.
 *
 * Delete: label/type verification against stale positions (a document that
 * changed under an open popup must never lose the WRONG footnote).
 * Save: normalization of parsed popup markdown to the single paragraph
 * footnote_definition accepts.
 */

import { describe, it, expect, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import {
  collectVerifiedFootnoteDeletions,
  buildDeleteFootnoteTransaction,
  normalizeToSingleParagraph,
} from "./footnoteEditOps";

// ---------------------------------------------------------------------------
// collectVerifiedFootnoteDeletions
// ---------------------------------------------------------------------------

function fakeNode(typeName: string, label: string, nodeSize: number): PMNode {
  return { type: { name: typeName }, attrs: { label }, nodeSize } as unknown as PMNode;
}

function fakeDoc(nodesByPos: Record<number, PMNode>) {
  return { nodeAt: (pos: number) => nodesByPos[pos] ?? null };
}

describe("collectVerifiedFootnoteDeletions", () => {
  const ref = fakeNode("footnote_reference", "1", 3);
  const def = fakeNode("footnote_definition", "1", 10);

  it("returns both nodes when types and labels match", () => {
    const doc = fakeDoc({ 5: ref, 100: def });
    const deletions = collectVerifiedFootnoteDeletions(doc, "1", 5, 100);
    expect(deletions).toEqual([
      { pos: 5, node: ref },
      { pos: 100, node: def },
    ]);
  });

  it("excludes a reference whose label no longer matches (stale position)", () => {
    const staleRef = fakeNode("footnote_reference", "2", 3);
    const doc = fakeDoc({ 5: staleRef, 100: def });
    const deletions = collectVerifiedFootnoteDeletions(doc, "1", 5, 100);
    expect(deletions).toEqual([{ pos: 100, node: def }]);
  });

  it("excludes a definition whose label no longer matches (stale position)", () => {
    const staleDef = fakeNode("footnote_definition", "9", 10);
    const doc = fakeDoc({ 5: ref, 100: staleDef });
    const deletions = collectVerifiedFootnoteDeletions(doc, "1", 5, 100);
    expect(deletions).toEqual([{ pos: 5, node: ref }]);
  });

  it("returns empty when both labels mismatch", () => {
    const doc = fakeDoc({
      5: fakeNode("footnote_reference", "2", 3),
      100: fakeNode("footnote_definition", "3", 10),
    });
    expect(collectVerifiedFootnoteDeletions(doc, "1", 5, 100)).toEqual([]);
  });

  it("excludes nodes of the wrong type", () => {
    const doc = fakeDoc({
      5: fakeNode("paragraph", "1", 3),
      100: fakeNode("paragraph", "1", 10),
    });
    expect(collectVerifiedFootnoteDeletions(doc, "1", 5, 100)).toEqual([]);
  });

  it("excludes missing nodes (nodeAt returns null)", () => {
    const doc = fakeDoc({});
    expect(collectVerifiedFootnoteDeletions(doc, "1", 5, 100)).toEqual([]);
  });

  it("skips null positions", () => {
    const doc = fakeDoc({ 5: ref });
    expect(collectVerifiedFootnoteDeletions(doc, "1", 5, null)).toEqual([
      { pos: 5, node: ref },
    ]);
    expect(collectVerifiedFootnoteDeletions(doc, "1", null, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDeleteFootnoteTransaction
// ---------------------------------------------------------------------------

describe("buildDeleteFootnoteTransaction", () => {
  function fakeTr() {
    const calls: Array<[number, number]> = [];
    const tr = {
      delete: vi.fn((from: number, to: number) => {
        calls.push([from, to]);
        return tr;
      }),
    };
    return { tr: tr as unknown as Transaction, calls };
  }

  it("returns null for empty deletions (nothing verified)", () => {
    const { tr } = fakeTr();
    expect(buildDeleteFootnoteTransaction(tr, [])).toBeNull();
  });

  it("deletes highest position first so earlier positions stay valid", () => {
    const { tr, calls } = fakeTr();
    const result = buildDeleteFootnoteTransaction(tr, [
      { pos: 5, node: fakeNode("footnote_reference", "1", 3) },
      { pos: 100, node: fakeNode("footnote_definition", "1", 10) },
    ]);
    expect(result).not.toBeNull();
    expect(calls).toEqual([
      [100, 110],
      [5, 8],
    ]);
  });

  it("handles definition-before-reference ordering", () => {
    const { tr, calls } = fakeTr();
    buildDeleteFootnoteTransaction(tr, [
      { pos: 50, node: fakeNode("footnote_reference", "1", 3) },
      { pos: 5, node: fakeNode("footnote_definition", "1", 10) },
    ]);
    expect(calls).toEqual([
      [50, 53],
      [5, 15],
    ]);
  });

  it("deletes a single verified node", () => {
    const { tr, calls } = fakeTr();
    buildDeleteFootnoteTransaction(tr, [
      { pos: 7, node: fakeNode("footnote_reference", "1", 2) },
    ]);
    expect(calls).toEqual([[7, 9]]);
  });
});

// ---------------------------------------------------------------------------
// normalizeToSingleParagraph — real schema + real parser
// ---------------------------------------------------------------------------

describe("normalizeToSingleParagraph", () => {
  function normalize(markdown: string): PMNode {
    return normalizeToSingleParagraph(testSchema, parseMarkdown(testSchema, markdown));
  }

  it("returns the paragraph unchanged for single-paragraph input", () => {
    const para = normalize("Hello **world**");
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("Hello world");
  });

  it("joins multiple paragraphs into one (blank-line input must not throw)", () => {
    const para = normalize("First paragraph\n\nSecond paragraph");
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("First paragraph Second paragraph");
  });

  it("preserves inline marks across joined paragraphs", () => {
    const para = normalize("**bold**\n\n*italic*");
    expect(para.type.name).toBe("paragraph");
    const markNames: string[] = [];
    para.forEach((child) => child.marks.forEach((m) => markNames.push(m.type.name)));
    expect(markNames).toContain("bold");
    expect(markNames).toContain("italic");
  });

  it("returns an empty paragraph for empty input", () => {
    const para = normalize("");
    expect(para.type.name).toBe("paragraph");
    expect(para.childCount).toBe(0);
  });

  it("returns an empty paragraph for whitespace-only input", () => {
    const para = normalize("   ");
    expect(para.type.name).toBe("paragraph");
    expect(para.childCount).toBe(0);
  });

  it("flattens non-paragraph blocks (heading) into paragraph text", () => {
    const para = normalize("# Heading\n\ntail");
    expect(para.type.name).toBe("paragraph");
    expect(para.textContent).toBe("Heading tail");
  });

  it("produces a node valid for footnote_definition content (single paragraph)", () => {
    // footnote_definition content spec is "paragraph" — exactly one.
    const para = normalize("a\n\nb\n\nc");
    expect(para.type.name).toBe("paragraph");
  });
});
