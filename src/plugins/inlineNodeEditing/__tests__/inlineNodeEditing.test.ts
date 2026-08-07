// @vitest-environment node
/**
 * Tests for inlineNodeEditing — extension structure and computeState logic.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { inlineNodeEditingExtension, inlineNodeEditingKey } from "../tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    math_inline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { content: { default: "" } },
    },
    image: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { src: { default: "" }, alt: { default: "" } },
    },
    footnote_reference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { id: { default: "" } },
    },
  },
});

function getPlugins() {
  return inlineNodeEditingExtension.config.addProseMirrorPlugins!.call({
    name: "inlineNodeEditing",
    options: {},
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
}

describe("inlineNodeEditingExtension", () => {
  it("has the correct name", () => {
    expect(inlineNodeEditingExtension.name).toBe("inlineNodeEditing");
  });

  it("is an Extension type", () => {
    expect(inlineNodeEditingExtension.type).toBe("extension");
  });

  it("defines ProseMirror plugins via addProseMirrorPlugins", () => {
    const config = inlineNodeEditingExtension.config;
    expect(config.addProseMirrorPlugins).toBeDefined();
    expect(typeof config.addProseMirrorPlugins).toBe("function");
  });

  it("exports a PluginKey", () => {
    expect(inlineNodeEditingKey).toBeDefined();
  });
});

describe("inlineNodeEditing plugin state", () => {
  it("creates state with empty decorations for text-only content", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text("hello world")]),
      ]),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBeNull();
    expect(pluginState!.entryDirection).toBeNull();
  });

  it("detects cursor before math_inline node (nodeAfter)", () => {
    const mathNode = schema.nodes.math_inline.create({ content: "x^2" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [mathNode]),
    ]);
    // Cursor at position 1 (before the math node inside paragraph)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBe(1);
    expect(pluginState!.entryDirection).toBe("left");
  });

  it("detects cursor after math_inline node (nodeBefore)", () => {
    const mathNode = schema.nodes.math_inline.create({ content: "x^2" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [mathNode]),
    ]);
    // Cursor at position after the math node (1 + nodeSize)
    const posAfter = 1 + mathNode.nodeSize;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, posAfter),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBe(1);
    expect(pluginState!.entryDirection).toBe("right");
  });

  it("detects cursor before image node", () => {
    const imageNode = schema.nodes.image.create({ src: "test.png" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [imageNode]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBe(1);
  });

  it("detects cursor before footnote_reference node", () => {
    const fnNode = schema.nodes.footnote_reference.create({ id: "1" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [fnNode]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBe(1);
  });

  it("returns null editingNodePos when cursor is in plain text", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello world")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState!.editingNodePos).toBeNull();
    expect(pluginState!.entryDirection).toBeNull();
  });

  it("handles text before and after inline node", () => {
    const mathNode = schema.nodes.math_inline.create({ content: "x" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("before"),
        mathNode,
        schema.text("after"),
      ]),
    ]);
    // Cursor in the "before" text, position 3
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
      plugins: getPlugins(),
    });

    const pluginState = inlineNodeEditingKey.getState(state);
    expect(pluginState!.editingNodePos).toBeNull();
  });

  it("preserves entry direction when same node is still being edited", () => {
    const mathNode = schema.nodes.math_inline.create({ content: "x" });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("a"), mathNode, schema.text("b")]),
    ]);
    // Start with cursor after math (from right)
    const posAfterMath = 2 + mathNode.nodeSize;
    const state1 = EditorState.create({
      doc,
      selection: TextSelection.create(doc, posAfterMath),
      plugins: getPlugins(),
    });

    const ps1 = inlineNodeEditingKey.getState(state1);
    expect(ps1!.entryDirection).toBe("right");

    // Now move cursor to before math (same node) — direction should be preserved from previous state
    // via the apply logic
    const tr = state1.tr.setSelection(TextSelection.create(doc, 2));
    const state2 = state1.apply(tr);

    const ps2 = inlineNodeEditingKey.getState(state2);
    expect(ps2!.editingNodePos).toBe(2);
    // Direction preserved because same node
    expect(ps2!.entryDirection).toBe("right");
  });

  it("maps decorations on non-selection non-doc-change transaction", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
      plugins: getPlugins(),
    });

    // Create a transaction that doesn't change doc or selection (e.g., setMeta)
    const tr = state.tr.setMeta("test", true);
    const newState = state.apply(tr);

    const pluginState = inlineNodeEditingKey.getState(newState);
    expect(pluginState).toBeDefined();
    expect(pluginState!.editingNodePos).toBeNull();
  });
});
