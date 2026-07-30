/**
 * Generators and helpers shared by the MultiSelection property tests.
 *
 * Purpose: keep the document/range/edit generators in one place so the
 * construction properties and the mapping properties explore the same input
 * space, and a widening of that space benefits both.
 *
 * @coordinates-with multiSelection.property.test.ts — construction properties
 * @coordinates-with multiSelectionMapping.property.test.ts — map() properties
 * @coordinates-with multiSelectionInvariants.ts — the contract they assert
 * @module plugins/multiCursor/__tests__/multiSelectionArbitraries
 */
import fc from "fast-check";
import { Schema } from "@tiptap/pm/model";
import type { Node } from "@tiptap/pm/model";
import { Fragment, Slice } from "@tiptap/pm/model";
import { SelectionRange } from "@tiptap/pm/state";
import { Mapping, ReplaceStep } from "@tiptap/pm/transform";
import { MultiSelection } from "../MultiSelection";

/** Minimal schema — only what a multi-cursor position needs. */
export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

/** A document of `paragraphs` paragraphs, each holding `perPara` characters. */
export function makeDoc(paragraphs: number, perPara: number): Node {
  const text = "abcdefghij".slice(0, perPara).padEnd(perPara, "x");
  return schema.node(
    "doc",
    null,
    Array.from({ length: paragraphs }, () =>
      schema.node("paragraph", null, perPara > 0 ? [schema.text(text)] : []),
    ),
  );
}

/**
 * Clamp a raw integer to a position inside a textblock.
 *
 * Positions 0 and `content.size` resolve at depth 0 — inside the doc but not
 * inside any paragraph — so a selection there is not a text position. Confining
 * the generator to `1 .. size-1` keeps every generated range meaningful instead
 * of spending runs on positions no real cursor occupies.
 */
export function clamp(pos: number, doc: Node): number {
  const max = Math.max(1, doc.content.size - 1);
  return Math.max(1, Math.min(pos, max));
}

/** Arbitrary document shape, kept small so positions stay easy to reason about. */
export const docArb = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 10 }))
  .map(([paras, chars]) => makeDoc(paras, chars));

/** A set of raw ranges, deliberately allowed to overlap, touch and duplicate. */
export function rangesArb(doc: Node): fc.Arbitrary<SelectionRange[]> {
  const maxPos = doc.content.size;
  return fc
    .array(
      fc.tuple(fc.integer({ min: 0, max: maxPos }), fc.integer({ min: 0, max: maxPos })),
      { minLength: 1, maxLength: 6 },
    )
    .map((pairs) =>
      pairs.map(([a, b]) =>
        new SelectionRange(doc.resolve(clamp(Math.min(a, b), doc)), doc.resolve(clamp(Math.max(a, b), doc))),
      ),
    );
}

/** Build a MultiSelection, returning the throw rather than propagating it. */
export function build(
  ranges: SelectionRange[],
  primaryIndex: number,
  backward?: boolean[],
): MultiSelection | Error {
  try {
    return new MultiSelection(ranges, primaryIndex, backward);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** The result of applying a generated insertion to a document. */
export interface Insertion {
  doc: Node;
  mapping: Mapping;
}

/**
 * Insert `len` characters at `at`, returning the new document and its mapping.
 * Returns null when the edit is not valid for this document shape.
 */
export function insertText(doc: Node, at: number, len: number): Insertion | null {
  const step = new ReplaceStep(at, at, new Slice(Fragment.from(schema.text("z".repeat(len))), 0, 0));
  const result = step.apply(doc);
  if (result.failed || !result.doc) return null;
  const mapping = new Mapping();
  mapping.appendMap(step.getMap());
  return { doc: result.doc, mapping };
}

/**
 * These properties run hundreds of generated cases each and are CPU-bound.
 * Vitest's 5s default is wall-clock, so under full worker parallelism on a
 * loaded machine contention alone can trip it on a green tree — the same false
 * signal the markdown round-trip properties hit (2026-07-28). A real regression
 * fails on an assertion in milliseconds, so a generous ceiling hides nothing.
 */
export const PROPERTY_TIMEOUT_MS = 30_000;
