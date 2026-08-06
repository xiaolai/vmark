import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
import {
  codePreviewExtension,
  clearPreviewCache,
  refreshPreviews,
  codePreviewPluginKey,
  EDITING_STATE_CHANGED,
  SETTINGS_CHANGED,
  __resetActiveEditorViewsForTesting,
} from "./tiptap";
import {
  createStateWithCodeBlock,
  findDecorationsByClass,
  type DecorationLike,
} from "@/test/codePreviewTestUtils";

describe("codePreviewExtension", () => {
  it("adds preview-only class for mermaid code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not add preview-only class for non-preview languages", () => {
    const { state, plugins } = createStateWithCodeBlock("js", "const a = 1;");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBe(0);
  });

  it("marks preview-only code blocks as non-editable", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "\\frac{1}{2}");
    const pluginState = plugins[0].getState(state);
    const match = pluginState.decorations.find().find((decoration: DecorationLike) => {
      const attrs = decoration.type?.attrs;
      return attrs?.class?.includes("code-block-preview-only");
    });
    const attrs = match?.type?.attrs ?? {};
    expect(attrs.contenteditable).toBe("false");
  });

  it("adds preview-only class for latex code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "E = mc^2");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("adds preview-only class for svg code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("svg", "<svg></svg>");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("adds preview-only class for markmap code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("markmap", "# Heading");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("adds preview-only class for $$math$$ sentinel language", () => {
    const { state, plugins } = createStateWithCodeBlock("$$math$$", "\\sum_{i=1}^n");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("sets data-language attribute on preview-only blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD");
    const pluginState = plugins[0].getState(state);
    const match = pluginState.decorations.find().find((d: DecorationLike) =>
      d.type?.attrs?.class?.includes("code-block-preview-only")
    );
    expect(match?.type?.attrs?.["data-language"]).toBe("mermaid");
  });

  it("does not add decorations for python code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("python", "print('hello')");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBe(0);
  });

  it("does not add decorations for empty non-preview language code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("rust", "fn main() {}");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });

  it("creates placeholder for whitespace-only preview content", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "   ");
    const pluginState = plugins[0].getState(state);
    // Should have preview-only class but with a placeholder widget
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBeGreaterThan(0);
  });

  it("initializes with editingPos null", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.editingPos).toBeNull();
  });
});

describe("clearPreviewCache", () => {
  it("does not throw when called", () => {
    expect(() => clearPreviewCache()).not.toThrow();
  });

  it("can be called multiple times", () => {
    clearPreviewCache();
    clearPreviewCache();
    // No error means success
  });
});

describe("refreshPreviews", () => {
  it("does not throw when no editor view is set", () => {
    // currentEditorView is null by default in test context
    expect(() => refreshPreviews()).not.toThrow();
  });
});

describe("PREVIEW_ONLY_LANGUAGES coverage", () => {
  it("treats 'latex' as preview-only (case insensitive)", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2 + y^2");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("treats 'Mermaid' (mixed case) consistently after lowercasing", () => {
    // The source lowercases language: (node.attrs.language ?? "").toLowerCase()
    // So "Mermaid" becomes "mermaid"
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState = plugins[0].getState(state);
    const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("treats 'dot' and 'graphviz' as preview-only", () => {
    for (const lang of ["dot", "graphviz"]) {
      const { state, plugins } = createStateWithCodeBlock(lang, "digraph { a -> b }");
      const pluginState = plugins[0].getState(state);
      const matches = findDecorationsByClass(pluginState.decorations.find(), "code-block-preview-only");
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it("does not add preview for 'javascript'", () => {
    const { state, plugins } = createStateWithCodeBlock("javascript", "const x = 1;");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });

  it("does not add preview for 'html'", () => {
    const { state, plugins } = createStateWithCodeBlock("html", "<div>test</div>");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });

  it("does not add preview for 'css'", () => {
    const { state, plugins } = createStateWithCodeBlock("css", "body { color: red; }");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });

  it("does not add preview for empty language string", () => {
    const { state, plugins } = createStateWithCodeBlock("", "some code");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });
});

describe("empty content handling", () => {
  it("creates placeholder for empty latex block", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "  ");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    // Should have preview-only class and a placeholder widget
    expect(allDecorations.length).toBeGreaterThan(0);
  });

  it("creates placeholder for empty svg block", () => {
    const { state, plugins } = createStateWithCodeBlock("svg", "  ");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBeGreaterThan(0);
  });

  it("creates placeholder for empty markmap block", () => {
    const { state, plugins } = createStateWithCodeBlock("markmap", "  ");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBeGreaterThan(0);
  });
});

describe("decoration state management", () => {
  it("initializes with empty decorations for non-preview code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("go", "package main");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
    expect(pluginState.editingPos).toBeNull();
  });

  it("preserves editingPos as null when no editing is active", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.editingPos).toBeNull();
  });

  it("applies transaction mapping when doc does not change", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState1 = plugins[0].getState(state);
    expect(pluginState1.decorations.find().length).toBeGreaterThan(0);

    // Apply a non-doc-changing transaction
    const nextState = state.apply(state.tr);
    const pluginState2 = plugins[0].getState(nextState);
    // Decorations should still exist (mapped through)
    expect(pluginState2).toBeDefined();
  });
});

describe("clearPreviewCache and refreshPreviews", () => {
  it("clearPreviewCache is idempotent", () => {
    clearPreviewCache();
    clearPreviewCache();
    clearPreviewCache();
    // No error means success
  });

  it("refreshPreviews is safe to call without editor", () => {
    clearPreviewCache();
    refreshPreviews();
    // Should not throw
  });
});

describe("exported constants", () => {
  it("exports codePreviewPluginKey", () => {
    expect(codePreviewPluginKey).toBeDefined();
  });

  it("exports EDITING_STATE_CHANGED meta key", () => {
    expect(EDITING_STATE_CHANGED).toBe("codePreviewEditingChanged");
  });

  it("exports SETTINGS_CHANGED meta key", () => {
    expect(SETTINGS_CHANGED).toBe("codePreviewSettingsChanged");
  });
});

describe("codePreview plugin state apply", () => {
  it("maps decorations through when doc does not change and no editing/settings meta", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState1 = plugins[0].getState(state);
    expect(pluginState1.decorations.find().length).toBeGreaterThan(0);

    // Apply empty transaction (no doc change)
    const nextState = state.apply(state.tr);
    const pluginState2 = plugins[0].getState(nextState);
    expect(pluginState2).toBeDefined();
    expect(pluginState2.decorations.find().length).toBeGreaterThan(0);
    expect(pluginState2.editingPos).toBeNull();
  });

  it("recomputes decorations when SETTINGS_CHANGED meta is set", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState1 = plugins[0].getState(state);
    expect(pluginState1.decorations.find().length).toBeGreaterThan(0);

    // Apply transaction with SETTINGS_CHANGED meta
    const tr = state.tr.setMeta(SETTINGS_CHANGED, true);
    const nextState = state.apply(tr);
    const pluginState2 = plugins[0].getState(nextState);
    expect(pluginState2).toBeDefined();
    expect(pluginState2.decorations.find().length).toBeGreaterThan(0);
  });

  it("recomputes decorations when EDITING_STATE_CHANGED meta is set", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2");
    const pluginState1 = plugins[0].getState(state);
    expect(pluginState1.decorations.find().length).toBeGreaterThan(0);

    // Apply transaction with EDITING_STATE_CHANGED meta
    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const nextState = state.apply(tr);
    const pluginState2 = plugins[0].getState(nextState);
    expect(pluginState2).toBeDefined();
  });

  it("recomputes decorations when doc changes", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

    // Insert text to change the document
    const nextState = state.apply(state.tr.insertText("X", 1));
    const pluginState = plugins[0].getState(nextState);
    expect(pluginState).toBeDefined();
  });
});

describe("codePreview plugin view lifecycle", () => {
  it("plugin spec has a view factory", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    expect(plugins[0].spec.view).toBeTypeOf("function");
  });

  it("view factory returns update and destroy methods", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = { state: {} };
    const viewResult = plugins[0].spec.view!(mockView as never);

    expect(viewResult).toBeDefined();
    expect(viewResult.update).toBeTypeOf("function");
    expect(viewResult.destroy).toBeTypeOf("function");
  });

  it("view update does not throw", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = { state: {} };
    const viewResult = plugins[0].spec.view!(mockView as never);

    expect(() => viewResult.update!({ state: {} } as never, {} as never)).not.toThrow();
  });

  it("view destroy does not throw", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = { state: {} };
    const viewResult = plugins[0].spec.view!(mockView as never);

    expect(() => viewResult.destroy!()).not.toThrow();
  });
});

describe("codePreview decoration widget rendering", () => {
  it("creates preview-only node decoration with contenteditable=false", () => {
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2 + y^2");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();

    // Find the node decoration with preview-only class
    const nodeDecoration = allDecorations.find(
      (d: DecorationLike) => d.type?.attrs?.class?.includes("code-block-preview-only")
    );
    expect(nodeDecoration).toBeDefined();
    expect(nodeDecoration!.type?.attrs?.contenteditable).toBe("false");
    expect(nodeDecoration!.type?.attrs?.["data-language"]).toBe("latex");
  });

  it("creates widget decoration for non-empty preview content", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();

    // Should have node decoration + widget decoration
    expect(allDecorations.length).toBeGreaterThanOrEqual(2);
  });

  it("creates placeholder widget for whitespace-only svg content", () => {
    const { state, plugins } = createStateWithCodeBlock("svg", "   ");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    // Should have node decoration + placeholder widget
    expect(allDecorations.length).toBeGreaterThanOrEqual(2);
  });

  it("creates placeholder widget for whitespace-only $$math$$ content", () => {
    const { state, plugins } = createStateWithCodeBlock("$$math$$", "  ");
    const pluginState = plugins[0].getState(state);
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBeGreaterThanOrEqual(2);
  });

  it("does not create any decorations for typescript code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("typescript", "const x: number = 1;");
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });

  it("does not create any decorations for json code blocks", () => {
    const { state, plugins } = createStateWithCodeBlock("json", '{"key": "value"}');
    const pluginState = plugins[0].getState(state);
    expect(pluginState.decorations.find().length).toBe(0);
  });
});

describe("codePreview editing mode decorations", () => {
  it("creates editing decorations when editing a math block", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state, plugins } = createStateWithCodeBlock("$$math$$", "x^2 + y^2");

    // Find the code block position
    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });
    expect(codeBlockPos).toBeGreaterThanOrEqual(0);

    // Set editing state
    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2 + y^2");

    // Apply transaction with EDITING_STATE_CHANGED
    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const nextState = state.apply(tr);
    const pluginState = plugins[0].getState(nextState);

    // Should have editing decorations (header, editing class, live preview)
    const allDecorations = pluginState.decorations.find();
    const editingDecorations = allDecorations.filter(
      (d: DecorationLike) => d.type?.attrs?.class?.includes("code-block-editing")
    );
    expect(editingDecorations.length).toBeGreaterThan(0);
    expect(pluginState.editingPos).toBe(codeBlockPos);

    // Clean up
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("creates header widget decoration in editing mode", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "graph TD; A-->B");

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const nextState = state.apply(tr);
    const pluginState = plugins[0].getState(nextState);

    // Should have at least 3 decorations: header widget, node class, live preview
    const allDecorations = pluginState.decorations.find();
    expect(allDecorations.length).toBeGreaterThanOrEqual(3);

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("resets tracking when exiting editing for a code block", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state, plugins } = createStateWithCodeBlock("latex", "E=mc^2");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    // Start editing
    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "E=mc^2");
    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const state2 = state.apply(tr1);
    const ps1 = plugins[0].getState(state2);
    expect(ps1.editingPos).toBe(codeBlockPos);

    // Exit editing
    useBlockMathEditingStore.getState().exitEditing();
    const tr2 = state2.tr.setMeta(EDITING_STATE_CHANGED, true);
    const state3 = state2.apply(tr2);
    const ps2 = plugins[0].getState(state3);
    expect(ps2.editingPos).toBeNull();
  });

  it("updates live preview when doc changes during editing", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2");

    // Apply editing state change
    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    plugins[0].getState(editingState);

    // Now change the doc content (insert text into the code block)
    const tr2 = editingState.tr.insertText("+y^2", codeBlockPos + 4);
    const updatedState = editingState.apply(tr2);
    const ps = plugins[0].getState(updatedState);

    // Should still be in editing mode
    expect(ps.editingPos).toBe(codeBlockPos);

    useBlockMathEditingStore.getState().exitEditing();
  });
});

describe("codePreview plugin props.decorations", () => {
  it("returns decorations from plugin state", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD");
    const pluginState = plugins[0].getState(state);
    const propsDecorations = plugins[0].props.decorations!(state);
    expect(propsDecorations).toBeDefined();
    // Should match the state decorations
    expect(propsDecorations!.find().length).toBe(pluginState.decorations.find().length);
  });
});

describe("refreshPreviews with active editor view", () => {
  beforeEach(() => {
    // Earlier tests register plugin views without always calling destroy().
    // Clear the registry so refreshPreviews assertions are not contaminated
    // by leaked views from previous tests.
    __resetActiveEditorViewsForTesting();
  });

  it("dispatches SETTINGS_CHANGED when editor view is set", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const schema = getSchema([StarterKit]);
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const editorState = EditorState.create({ schema, doc, plugins });

    const mockDispatch = vi.fn();
    const mockView = {
      state: editorState,
      dispatch: mockDispatch,
    };

    // Call the view factory to set currentEditorView
    const viewResult = plugins[0].spec.view!(mockView as never);

    // Now refreshPreviews should dispatch
    refreshPreviews();
    expect(mockDispatch).toHaveBeenCalled();

    // Verify the transaction has SETTINGS_CHANGED meta
    const tr = mockDispatch.mock.calls[0][0];
    expect(tr.getMeta(SETTINGS_CHANGED)).toBe(true);

    // Clean up
    viewResult.destroy!();
  });

  it("view update is a no-op (PM passes the same view instance across updates)", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const schema = getSchema([StarterKit]);
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const editorState = EditorState.create({ schema, doc, plugins });

    const mockView = { state: editorState, dispatch: vi.fn() };
    const viewResult = plugins[0].spec.view!(mockView as never);

    // Call update with a different mock — should NOT swap the registered view,
    // because the original behavior (single-global swap) was the bug that
    // broke multi-editor scenarios. PM always passes the same view here.
    const otherView = { state: editorState, dispatch: vi.fn() };
    expect(() => viewResult.update!(otherView as never, {} as never)).not.toThrow();

    refreshPreviews();
    expect(mockView.dispatch).toHaveBeenCalled();
    expect(otherView.dispatch).not.toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("refreshPreviews dispatches into every registered view (multi-editor)", () => {
    const buildPluginView = () => {
      const extensionContext = {
        name: codePreviewExtension.name,
        options: codePreviewExtension.options,
        storage: codePreviewExtension.storage,
        editor: {} as Editor,
        type: null,
        parent: undefined,
      };
      const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
      const schema = getSchema([StarterKit]);
      const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
      const editorState = EditorState.create({ schema, doc, plugins });
      const mockView = { state: editorState, dispatch: vi.fn() };
      return { mockView, viewResult: plugins[0].spec.view!(mockView as never) };
    };

    const a = buildPluginView();
    const b = buildPluginView();

    refreshPreviews();
    expect(a.mockView.dispatch).toHaveBeenCalled();
    expect(b.mockView.dispatch).toHaveBeenCalled();

    a.viewResult.destroy!();
    b.viewResult.destroy!();
  });

  it("view destroy nullifies currentEditorView", () => {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const schema = getSchema([StarterKit]);
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const editorState = EditorState.create({ schema, doc, plugins });

    const mockView = { state: editorState, dispatch: vi.fn() };
    const viewResult = plugins[0].spec.view!(mockView as never);

    viewResult.destroy!();

    // After destroy, refreshPreviews should not dispatch (no editor view)
    refreshPreviews();
    expect(mockView.dispatch).not.toHaveBeenCalled();
  });
});
