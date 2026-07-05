// WI-2.1 — codePreview must not run a full-document descendants() walk on every
// keystroke in a prose-only doc (O1).

import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { AttrStep } from "@tiptap/pm/transform";
import { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension } from "../tiptap";
import {
  changesIntersectRanges,
  transactionMayAffectCodeBlock,
} from "../transactionScan";

function createProseOnlyState() {
  const schema = getSchema([StarterKit]);
  const extensionContext = {
    name: codePreviewExtension.name,
    options: codePreviewExtension.options,
    storage: codePreviewExtension.storage,
    editor: {} as Editor,
    type: null,
    parent: undefined,
  };
  const plugins =
    codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("hello world")),
  ]);
  const state = EditorState.create({ schema, doc, plugins });
  return { state, plugins, schema };
}

describe("codePreview prose-only fast path (O1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT walk the whole document when typing in a prose-only doc", () => {
    const { state } = createProseOnlyState();
    // The full scan calls Node.prototype.descendants; the prose-only fast path
    // uses doc.forEach (top-level) + Fragment.descendants (on the tiny inserted
    // slice) instead — so Node.descendants must not be called.
    const descSpy = vi.spyOn(PMNode.prototype, "descendants");
    state.apply(state.tr.insertText("!", 6));
    expect(descSpy).not.toHaveBeenCalled();
  });

  it("DOES scan when a previewable code block is inserted into a prose-only doc", () => {
    const { state, schema } = createProseOnlyState();
    const descSpy = vi.spyOn(PMNode.prototype, "descendants");
    const codeBlock = schema.nodes.codeBlock.create(
      { language: "mermaid" },
      schema.text("graph TD; A-->B"),
    );
    state.apply(state.tr.insert(state.doc.content.size, codeBlock));
    expect(descSpy).toHaveBeenCalled();
  });

  it("DOES re-scan on an AttrStep (a code block's language change to previewable)", () => {
    // A non-previewable code block keeps codeBlockRanges at 0 (fast-path
    // eligible). Changing its language via an AttrStep carries no slice, so the
    // guard must bail on the AttrStep and run the full scan, or the new preview
    // would be missed (audit finding — nested/attr-change case).
    const { schema, plugins } = createProseOnlyState();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("hi")),
      schema.nodes.codeBlock.create({ language: "js" }, schema.text("a")),
    ]);
    const state = EditorState.create({ schema, doc, plugins });

    let cbPos = -1;
    state.doc.forEach((node, offset) => {
      if (node.type.name === "codeBlock") cbPos = offset;
    });
    expect(cbPos).toBeGreaterThanOrEqual(0);

    const descSpy = vi.spyOn(PMNode.prototype, "descendants");
    state.apply(state.tr.step(new AttrStep(cbPos, "language", "mermaid")));
    expect(descSpy).toHaveBeenCalled();
  });

  it("DOES build decorations when an edit inside a NESTED yaml block makes it workflow-shaped", () => {
    // Audit F16 — the prose-only fast path checked only TOP-LEVEL blocks, so a
    // yaml block nested in a blockquote could become workflow-shaped (and thus
    // previewable) without decorations ever being built.
    const { schema, plugins } = createProseOnlyState();
    // "n:" is not a top-level `on:` key — not workflow-shaped yet, so the
    // tracked previewable ranges stay at 0 (fast-path eligible).
    const yaml = "n: push\njobs:\n  build:\n    runs-on: ubuntu-latest";
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("hi")),
      schema.nodes.blockquote.create(null, [
        schema.nodes.codeBlock.create({ language: "yaml" }, schema.text(yaml)),
      ]),
    ]);
    const state = EditorState.create({ schema, doc, plugins });
    expect(plugins[0].getState(state).codeBlockRanges.length).toBe(0);

    // Find the nested code block's content start and prepend "o" → "on: push…"
    // completes the workflow shape. The inserted slice is plain text (no
    // code-block node), so only a depth-aware previewability check catches it.
    let cbPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") {
        cbPos = pos;
        return false;
      }
      return true;
    });
    expect(cbPos).toBeGreaterThanOrEqual(0);

    const after = state.apply(state.tr.insertText("o", cbPos + 1));
    expect(plugins[0].getState(after).codeBlockRanges.length).toBe(1);
  });
});

// Direct unit coverage for the conservative slice/AttrStep guard — the plugin
// path now short-circuits on the depth-aware count before reaching it, so its
// true-branches need direct exercise.
describe("transactionMayAffectCodeBlock", () => {
  it("bails on any AttrStep (no slice to scan)", () => {
    const { schema, plugins } = createProseOnlyState();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.codeBlock.create({ language: "js" }, schema.text("a")),
    ]);
    const state = EditorState.create({ schema, doc, plugins });
    const tr = state.tr.step(new AttrStep(0, "language", "python"));
    expect(transactionMayAffectCodeBlock(tr)).toBe(true);
  });

  it("detects a code block inside an inserted slice", () => {
    const { state, schema } = createProseOnlyState();
    const block = schema.nodes.codeBlock.create({ language: "js" }, schema.text("x"));
    const tr = state.tr.insert(state.doc.content.size, block);
    expect(transactionMayAffectCodeBlock(tr)).toBe(true);
  });

  it("returns false for a plain text insertion", () => {
    const { state } = createProseOnlyState();
    const tr = state.tr.insertText("!", 6);
    expect(transactionMayAffectCodeBlock(tr)).toBe(false);
  });

  it("skips steps that carry no slice (mark changes)", () => {
    const { state, schema } = createProseOnlyState();
    const tr = state.tr.addMark(1, 6, schema.marks.bold.create());
    expect(transactionMayAffectCodeBlock(tr)).toBe(false);
  });
});

describe("changesIntersectRanges", () => {
  it("returns false immediately for an empty range list", () => {
    const { state } = createProseOnlyState();
    const tr = state.tr.insertText("!", 6);
    expect(changesIntersectRanges(tr, [])).toBe(false);
  });

  /** Build a doc with a paragraph followed by a mermaid block; return its range. */
  function createStateWithBlock() {
    const { schema, plugins } = createProseOnlyState();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("hi")),
      schema.nodes.codeBlock.create({ language: "mermaid" }, schema.text("graph TD")),
    ]);
    const state = EditorState.create({ schema, doc, plugins });
    let from = -1;
    let to = -1;
    state.doc.forEach((node, offset) => {
      if (node.type.name === "codeBlock") {
        from = offset;
        to = offset + node.nodeSize;
      }
    });
    expect(from).toBeGreaterThanOrEqual(0);
    return { state, ranges: [{ from, to }] };
  }

  it("detects an in-block edit when a preceding step in the SAME transaction shifts positions", () => {
    // Audit finding: step i's map speaks the coordinate space of the doc
    // BEFORE step i, but the tracked ranges are in the ORIGINAL doc space.
    // Step 1 inserts 50 chars of prose before the block; step 2 then edits
    // inside the block at post-step-1 positions. Without forward-mapping the
    // ranges, step 2's positions land past the unmapped range end and the
    // edit wrongly takes the fast path (stale decorations).
    const { state, ranges } = createStateWithBlock();
    const tr = state.tr.insertText("x".repeat(50), 1);
    const insidePos = tr.mapping.map(ranges[0].from + 1);
    tr.insertText("A", insidePos);
    expect(changesIntersectRanges(tr, ranges)).toBe(true);
  });

  it("still returns false when every step of a multi-step transaction stays outside the ranges", () => {
    const { state, ranges } = createStateWithBlock();
    // Two prose insertions, both before the block — fast path must survive.
    const tr = state.tr.insertText("x".repeat(50), 1);
    tr.insertText("y", 2);
    expect(changesIntersectRanges(tr, ranges)).toBe(false);
  });

  it("detects a single-step edit inside a tracked range", () => {
    const { state, ranges } = createStateWithBlock();
    const tr = state.tr.insertText("A", ranges[0].from + 1);
    expect(changesIntersectRanges(tr, ranges)).toBe(true);
  });
});
