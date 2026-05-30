// WI-2.1 — codePreview must not run a full-document descendants() walk on every
// keystroke in a prose-only doc (O1).

import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { AttrStep } from "@tiptap/pm/transform";
import { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension } from "../tiptap";

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
});
