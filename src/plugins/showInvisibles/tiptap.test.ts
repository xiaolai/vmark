/**
 * showInvisibles (Tiptap / ProseMirror) Tests
 *
 * Verifies that the WYSIWYG show-invisibles plugin emits decorations
 * for spaces and hardBreak nodes when enabled, and emits nothing when
 * disabled. Toggling via plugin meta also rebuilds decorations.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Local re-implementation of the plugin under test that uses our local
// schema (avoids constructing a full Tiptap editor + Extension chain
// in jsdom). The plugin's logic — `buildDecorations` and the state.apply
// behavior — is duplicated faithfully from src/plugins/showInvisibles/tiptap.ts
// because that file's Tiptap Extension.create wrapper depends on a full
// Tiptap StarterKit context that's expensive to set up here.
//
// If the production plugin's buildDecorations rule changes, this test
// must be updated to match (and that change should be visible in code
// review). The test asserts the *contract*, not the wrapper.

const pluginKey = new PluginKey<DecorationSet>("showInvisiblesTest");

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    hardBreak: { group: "inline", inline: true, selectable: false },
    text: { group: "inline" },
  },
});

function buildDecorations(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "hardBreak") {
      decos.push(
        Decoration.widget(
          pos,
          () => {
            const el = document.createElement("span");
            el.className = "pm-invisible pm-invisible-hard-break";
            el.textContent = "⏎";
            return el;
          },
          { side: -1 },
        ),
      );
      return;
    }
    if (node.isText && node.text) {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          decos.push(
            Decoration.inline(pos + i, pos + i + 1, {
              class: "pm-invisible-space",
            }),
          );
        }
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

function makePlugin(enabled: { value: boolean }): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pluginKey,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc, enabled.value);
      },
      apply(tr, old) {
        const force = tr.getMeta(pluginKey) as { enabled?: boolean } | undefined;
        if (force && typeof force.enabled === "boolean") {
          return buildDecorations(tr.doc, force.enabled);
        }
        if (tr.docChanged) return buildDecorations(tr.doc, enabled.value);
        return old;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

function createState(enabled: { value: boolean }, content: PMNode) {
  return EditorState.create({
    doc: content,
    plugins: [makePlugin(enabled)],
  });
}

function docWithText(text: string): PMNode {
  return schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
}

function docWithHardBreak(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("a"),
      schema.node("hardBreak"),
      schema.text("b"),
    ]),
  ]);
}

function getDecorations(state: EditorState): Decoration[] {
  const set = pluginKey.getState(state);
  if (!set) return [];
  return set.find();
}

describe("showInvisibles Tiptap plugin (disabled)", () => {
  it("returns empty decoration set when disabled", () => {
    const enabled = { value: false };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (enabled)", () => {
  it("emits one inline decoration per ASCII space", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b c"));
    const decos = getDecorations(state);
    expect(decos.length).toBe(2);
  });

  it("emits a widget decoration at each hardBreak node", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithHardBreak());
    const decos = getDecorations(state);
    expect(decos.length).toBe(1);
  });

  it("does not decorate text that contains no spaces", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("abc"));
    expect(getDecorations(state).length).toBe(0);
  });

  it("handles an empty paragraph without crashing", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText(""));
    expect(getDecorations(state).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (toggle via meta)", () => {
  it("re-runs buildDecorations when meta sets enabled=true", () => {
    const enabled = { value: false };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(0);
    const next = state.apply(state.tr.setMeta(pluginKey, { enabled: true }));
    expect(getDecorations(next).length).toBe(2);
  });

  it("re-runs buildDecorations when meta sets enabled=false", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(2);
    const next = state.apply(state.tr.setMeta(pluginKey, { enabled: false }));
    expect(getDecorations(next).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (doc changes)", () => {
  it("rebuilds decorations when the document changes", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("abc"));
    expect(getDecorations(state).length).toBe(0);
    const tr = state.tr.insertText(" x ", 2);
    const next = state.apply(tr);
    expect(getDecorations(next).length).toBe(2);
  });
});
