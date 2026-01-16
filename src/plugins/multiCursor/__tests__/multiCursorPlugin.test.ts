import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { multiCursorPlugin, multiCursorPluginKey } from "../multiCursorPlugin";
import { MultiSelection } from "../MultiSelection";

// Simple schema for testing
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function createState(text: string) {
  return EditorState.create({
    doc: createDoc(text),
    schema,
    plugins: [multiCursorPlugin()],
  });
}

describe("multiCursorPlugin", () => {
  describe("plugin creation", () => {
    it("creates plugin with key", () => {
      const plugin = multiCursorPlugin();
      expect(plugin.spec.key).toBe(multiCursorPluginKey);
    });

    it("integrates with EditorState", () => {
      const state = createState("hello world");
      expect(state.plugins).toHaveLength(1);
      expect(multiCursorPluginKey.getState(state)).toBeDefined();
    });
  });

  describe("plugin state", () => {
    it("has empty initial state", () => {
      const state = createState("hello world");
      const pluginState = multiCursorPluginKey.getState(state);
      expect(pluginState).toEqual({ isActive: false });
    });

    it("tracks when MultiSelection is active", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      const tr = state.tr.setSelection(multiSel);
      const newState = state.apply(tr);
      const pluginState = multiCursorPluginKey.getState(newState);

      expect(pluginState?.isActive).toBe(true);
    });
  });

  describe("appendTransaction", () => {
    it("maintains MultiSelection through transactions", () => {
      const state = createState("hello world");
      const doc = state.doc;
      const $pos1 = doc.resolve(1);
      const $pos2 = doc.resolve(7);

      const ranges = [
        new SelectionRange($pos1, $pos1),
        new SelectionRange($pos2, $pos2),
      ];
      const multiSel = new MultiSelection(ranges, 0);

      // Set multi-selection
      const tr1 = state.tr.setSelection(multiSel);
      const stateWithMulti = state.apply(tr1);

      // Make a non-selection-changing transaction
      const tr2 = stateWithMulti.tr.setMeta("test", true);
      const finalState = stateWithMulti.apply(tr2);

      // MultiSelection should be maintained
      expect(finalState.selection).toBeInstanceOf(MultiSelection);
    });
  });
});
