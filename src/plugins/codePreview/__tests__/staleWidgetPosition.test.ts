// Audit F13 — widget click handlers capture nodeStart at build time; the
// apply() fast path in tiptap.ts maps decorations across doc changes WITHOUT
// rebuilding them, so after typing above a preview the closure's position is
// stale. Entering edit mode must re-resolve the block's current position.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import { codePreviewExtension, SETTINGS_CHANGED } from "../tiptap";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";

type WidgetDecoration = {
  type?: { attrs?: Record<string, string>; toDOM?: unknown };
};

function createPluginState() {
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
  // Paragraph first, then an EMPTY mermaid block — empty content produces the
  // placeholder widget, whose click handler is created directly in
  // previewDecorations.ts (no renderer module involved).
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("hello")),
    schema.nodes.codeBlock.create({ language: "mermaid" }),
  ]);
  const state = EditorState.create({ schema, doc, plugins });
  return { state, plugins, schema };
}

function findCodeBlockPos(state: EditorState): number {
  let pos = -1;
  state.doc.descendants((node, p) => {
    if (node.type.name === "codeBlock") {
      pos = p;
      return false;
    }
    return true;
  });
  return pos;
}

describe("stale widget position after fast-path mapping", () => {
  beforeEach(() => {
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("enters edit mode at the block's CURRENT position after typing above it", () => {
    const { state, plugins } = createPluginState();

    // Build decorations (init returns an empty set; force a rebuild).
    const built = state.apply(state.tr.setMeta(SETTINGS_CHANGED, true));
    const oldPos = findCodeBlockPos(built);
    expect(oldPos).toBeGreaterThan(0);

    // Type in the paragraph BEFORE the block: the change doesn't intersect the
    // tracked range and the block count is unchanged, so the fast path maps
    // the existing decorations instead of rebuilding them.
    const typed = built.apply(built.tr.insertText(" world", 6));
    const newPos = findCodeBlockPos(typed);
    expect(newPos).toBeGreaterThan(oldPos); // position actually shifted

    const pluginState = plugins[0].getState(typed);
    const widgets = pluginState.decorations
      .find()
      .filter((d: WidgetDecoration) => !d.type?.attrs?.class);
    expect(widgets.length).toBeGreaterThan(0);

    const mockView = {
      state: typed,
      dispatch: vi.fn((tr) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
    };

    // Materialize the placeholder widget and double-click it to enter edit mode.
    const el = (widgets[0] as { type: { toDOM: (v: unknown) => HTMLElement } }).type.toDOM(
      mockView,
    );
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    // The edit session must target the block's CURRENT (mapped) position, not
    // the stale build-time one.
    expect(useBlockMathEditingStore.getState().editingPos).toBe(newPos);

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("falls back to the build-time position when the plugin state is unavailable", () => {
    const { state, plugins, schema } = createPluginState();
    const built = state.apply(state.tr.setMeta(SETTINGS_CHANGED, true));
    const pos = findCodeBlockPos(built);

    const pluginState = plugins[0].getState(built);
    const widgets = pluginState.decorations
      .find()
      .filter((d: WidgetDecoration) => !d.type?.attrs?.class);
    expect(widgets.length).toBeGreaterThan(0);

    // A view whose state has the same doc but NOT the plugin — the resolver
    // must fall back to the closure position.
    const bareState = EditorState.create({ schema, doc: built.doc });
    const mockView = {
      state: bareState,
      dispatch: vi.fn((tr) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
    };

    const el = (widgets[0] as { type: { toDOM: (v: unknown) => HTMLElement } }).type.toDOM(
      mockView,
    );
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(useBlockMathEditingStore.getState().editingPos).toBe(pos);

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("aborts instead of editing the wrong node when the position no longer holds a code block", () => {
    const { state, plugins, schema } = createPluginState();
    const built = state.apply(state.tr.setMeta(SETTINGS_CHANGED, true));

    const pluginState = plugins[0].getState(built);
    const widgets = pluginState.decorations
      .find()
      .filter((d: WidgetDecoration) => !d.type?.attrs?.class);
    expect(widgets.length).toBeGreaterThan(0);

    // A plugin-less view over a paragraphs-only doc: nothing at the closure
    // position is a code block, so entering edit mode must be a no-op.
    const proseDoc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("just prose, no blocks here")),
    ]);
    const bareState = EditorState.create({ schema, doc: proseDoc });
    const mockView = {
      state: bareState,
      dispatch: vi.fn(),
      focus: vi.fn(),
    };

    const el = (widgets[0] as { type: { toDOM: (v: unknown) => HTMLElement } }).type.toDOM(
      mockView,
    );
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
    expect(mockView.dispatch).not.toHaveBeenCalled();
  });
});
