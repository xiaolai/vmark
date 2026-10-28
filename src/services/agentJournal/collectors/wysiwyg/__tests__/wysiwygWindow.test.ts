// WI-AL1.4 — The WYSIWYG window: consecutive flushes extend one window up to its declared step budget (past it, a capOverflow whole break that later flushes keep), every whole-document reason maps to its break (chain-cap and window-budget as capOverflow, the rest snapshot-only), an unknown step, a base document that does not serialize to the session's base text, a document over the span size budget and a failed head serialization each fail closed, an identity window yields no ranges, a window that holds steps yet names no break is a whole break (WI-AL2.0: never an identity), one edit yields one bounded range, and a window whose touched ranges would cost more than the range-mapping budget to carry is a capOverflow break.
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { StepMap } from "@tiptap/pm/transform";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { SPAN_SERIALIZE_LIMIT } from "@/utils/markdownPipeline/serializerSpans";
import { MAX_RANGE_MAPPINGS } from "../pmSteps";
import type { ChainResult, Edge } from "../txnLedger";
import { MAX_WINDOW_STEPS, extendWindow, materializeWindow, type Spanned, type WholeReason } from "../wysiwygWindow";

const schema = getSchema(createTiptapExtensions());
const OPTS = { preserveBlankLines: true } as const;
const spanned = (md: string): Spanned => ({ doc: parseMarkdown(schema, md, OPTS), spans: null });
const edge = (s: Spanned, maps: number, unknownSteps: string[] = []): Edge => ({
  before: s.doc,
  after: s.doc,
  maps: Array.from({ length: maps }, () => StepMap.empty),
  touched: [],
  unknownSteps,
});
const ok = (...edges: Edge[]): ChainResult => ({ ok: true, edges });

describe("wysiwyg window", () => {
  it("declares its step budget", () => {
    expect(MAX_WINDOW_STEPS).toBe(16_384);
  });

  it("an identity window yields no ranges", () => {
    const a = spanned("one\n\ntwo\n");
    const w = extendWindow(null, a, ok(), a, "one\n\ntwo\n", OPTS);
    expect(materializeWindow(schema, w, "one\n\ntwo\n")).toEqual([]);
    expect(w.ran).toBe(true);
  });

  it("a window that holds steps but whose block map names no break is a whole break, never an identity", () => {
    const a = spanned("one\n\ntwo\n");
    const w = extendWindow(null, a, ok(edge(a, 1)), a, "one\n\ntwo\n", OPTS);
    expect(materializeWindow(schema, w, "one\n\ntwo\n")).toEqual({ whole: "snapshotOnly", origin: "wysiwyg:unlocated-steps" });
  });

  it("an edit of one block is one bounded range named by its block", () => {
    const a = spanned("one\n\ntwo\n");
    const b = spanned("one\n\ntwo!\n");
    const w = extendWindow(null, a, ok(), b, "one\n\ntwo!\n", OPTS);
    const out = materializeWindow(schema, w, "one\n\ntwo\n");
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
  });

  it("extends a pending window up to the step budget, then breaks and stays broken", () => {
    const a = spanned("x\n");
    const first = extendWindow(null, a, ok(edge(a, MAX_WINDOW_STEPS)), a, "x\n", OPTS);
    expect(first.whole).toBeNull();
    expect(first.steps).toBe(MAX_WINDOW_STEPS);
    const over = extendWindow(first, a, ok(edge(a, 1)), a, "x\n", OPTS);
    expect(over.whole).toBe("window-budget");
    expect(over.edges).toEqual([]);
    const later = extendWindow(over, a, ok(), a, "x\n", OPTS);
    expect(later.whole).toBe("window-budget");
    expect(materializeWindow(schema, later, "x\n")).toEqual({ whole: "capOverflow", origin: "wysiwyg:window-budget" });
  });

  it.each<[WholeReason, string]>([
    ["no-certificate", "snapshotOnly"],
    ["unobserved-transaction", "snapshotOnly"],
    ["chain-cap", "capOverflow"],
    ["window-budget", "capOverflow"],
  ])("whole reason %s is a %s break", (reason, kind) => {
    const a = spanned("x\n");
    const w = extendWindow(null, a, reason, a, "x\n", OPTS);
    expect(materializeWindow(schema, w, "x\n")).toEqual({ whole: kind, origin: `wysiwyg:${reason}` });
  });

  it("a window whose touched ranges would cost past the mapping budget is a capOverflow, not a quadratic walk", () => {
    const a = spanned("x\n");
    // Each edge touches a fresh, disjoint range that every later step map must carry: n edges cost n²/2 mappings.
    const n = Math.ceil(Math.sqrt(2 * MAX_RANGE_MAPPINGS)) + 2;
    const edges = Array.from({ length: n }, (_, i): Edge => ({ ...edge(a, 1), touched: [[4 * i, 4 * i + 1]] }));
    const w = extendWindow(null, a, ok(...edges), a, "x\n", OPTS);
    expect(materializeWindow(schema, w, "x\n")).toEqual({ whole: "capOverflow", origin: "wysiwyg:correspondence-budget" });
  });

  it("a failed chain keeps its reason", () => {
    const a = spanned("x\n");
    const w = extendWindow(null, a, { ok: false, reason: "chain-cap" }, a, "x\n", OPTS);
    expect(materializeWindow(schema, w, "x\n")).toEqual({ whole: "capOverflow", origin: "wysiwyg:chain-cap" });
  });

  it("an unknown step anywhere in the window breaks it", () => {
    const a = spanned("x\n");
    const w = extendWindow(extendWindow(null, a, ok(edge(a, 1, ["opaque"])), a, "x\n", OPTS), a, ok(edge(a, 1)), a, "x\n", OPTS);
    expect(materializeWindow(schema, w, "x\n")).toEqual({ whole: "snapshotOnly", origin: "wysiwyg:unknown-step" });
  });

  it("a base document that does not serialize to the base text breaks (load normalization)", () => {
    const a = spanned("* item\n");
    expect(serializeMarkdown(schema, a.doc, OPTS)).not.toBe("* item\n");
    const w = extendWindow(null, a, ok(), a, "- item\n", OPTS);
    expect(materializeWindow(schema, w, "* item\n")).toEqual({ whole: "snapshotOnly", origin: "wysiwyg:base-mismatch" });
  });

  it("a document over the span size budget is a capOverflow", () => {
    const big = "a".repeat(SPAN_SERIALIZE_LIMIT + 1);
    const a = spanned(`${big}\n`);
    const w = extendWindow(null, a, ok(), a, `${big}\n`, OPTS);
    expect(materializeWindow(schema, w, `${big}\n`)).toEqual({ whole: "capOverflow", origin: "wysiwyg:size-budget" });
  });

  it("a head that does not serialize to the flushed text is uncertified", () => {
    const a = spanned("x\n");
    const w = extendWindow(null, a, ok(), a, "not what was flushed\n", OPTS);
    expect(materializeWindow(schema, w, "x\n")).toEqual({ whole: "snapshotOnly", origin: "wysiwyg:serializer-uncertified" });
  });

  it("an empty document is a window like any other", () => {
    const a = spanned("");
    const b = spanned("new\n");
    const w = extendWindow(null, a, ok(), b, "new\n", OPTS);
    const out = materializeWindow(schema, w, serializeMarkdown(schema, a.doc, OPTS));
    expect(Array.isArray(out)).toBe(true);
  });
});
