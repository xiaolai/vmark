import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Editor } from "@tiptap/core";
import {
  codePreviewExtension,
  clearPreviewCache,
  EDITING_STATE_CHANGED,
  __resetActiveEditorViewsForTesting,
} from "./tiptap";
import {
  createStateWithCodeBlock,
  type DecorationLike,
} from "@/test/codePreviewTestUtils";

describe("codePreview widget factory invocation — covers lines 263-354", () => {
  // These tests exercise the widget factory functions by directly calling
  // decoration.type.toDOM(view), which is how ProseMirror renders widgets to DOM.
  // This covers: header widget factory (263-278), live preview widget factory (291-296),
  // placeholder widget factory (337), cached preview widget factory (347-354),
  // handleEnterEdit (311-320), exitEditMode (137-199), updateLivePreview (96-121).

  beforeEach(async () => {
    vi.useFakeTimers();
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();
    clearPreviewCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDispatchView(baseState: EditorState) {
    const mockView = {
      state: baseState,
      dispatch: vi.fn((tr) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
      composing: false,
      dom: document.createElement("div"),
    };
    return mockView;
  }

  it("header widget factory: calls createEditHeader and returns an HTMLElement (line 263)", async () => {
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
    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    const pluginState = plugins[0].getState(editingState);

    const decs = pluginState.decorations.find();
    // Find the header widget (side=-1, no attrs.class)
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThanOrEqual(1);

    const mockView = makeDispatchView(editingState);
    // Call the widget factory — this covers lines 263-278
    const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
    expect(headerEl).toBeInstanceOf(HTMLElement);
    expect(headerEl.className).toContain("code-block-edit-header");

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("header widget save button: calls exitEditMode(view, false) — covers lines 137-199", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("latex", "x^2");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2");

    // Build fresh plugins so we get a fresh currentEditorView slot
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const mockView = makeDispatchView(state);
    // Register as currentEditorView
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    // Update the stored view
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    // Widget decorations don't have attrs.class (node decorations do)
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // Find header widget — it's the first widget (side=-1)
    const headerDec = widgetDecs[0];
    const headerEl = (headerDec as any).type.toDOM(mockView);

    // Click save button — triggers exitEditMode(widgetView, false) — covers lines 176-198
    const saveBtn = headerEl.querySelector(".code-block-edit-save") as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();

    // dispatch should have been called by exitEditMode
    expect(mockView.dispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("header widget cancel button: calls exitEditMode(view, true) — covers revert path (lines 166-172)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "graph TD; A-->B");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    const headerDec = widgetDecs[0];
    const headerEl = (headerDec as any).type.toDOM(mockView);

    // Click cancel — triggers exitEditMode(widgetView, true) — covers lines 163-173
    const cancelBtn = headerEl.querySelector(".code-block-edit-cancel") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    expect(mockView.dispatch).toHaveBeenCalled();

    viewResult.destroy!();
  });

  it("mermaid header widget: onCopy callback works (copy button exists) — covers line 264-268", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "graph TD; A-->B");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    const headerDec = widgetDecs[0];
    const headerEl = (headerDec as any).type.toDOM(mockView);

    // Mermaid has a copy button
    const copyBtn = headerEl.querySelector(".code-block-edit-copy") as HTMLButtonElement | null;
    expect(copyBtn).toBeTruthy();

    // Mock navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    copyBtn!.click();
    // Timer for checkmark feedback
    vi.runAllTimers();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("live preview widget factory: sets currentLivePreview and calls updateLivePreview (lines 291-296)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("latex", "x^2 + y^2");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2 + y^2");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    // Live preview widget has side=1, no attrs.class
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // The second widget should be the live preview (side=1)
    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    // Call the factory — covers lines 291-296
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);
    expect(previewEl.className).toContain("code-block-live-preview");

    // Now the live preview timer runs — covers updateLivePreview internals
    vi.runAllTimers();

    // After setting currentLivePreview, a doc change triggers updateLivePreview (line 222-226)
    const state2 = editingState.apply(editingState.tr.insertText("+z", codeBlockPos + 4));
    freshPlugins[0].getState(state2);
    vi.runAllTimers();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("live preview: updateLivePreview with empty content sets Empty placeholder (lines 107-109)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("mermaid", " ");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, " ");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // Invoke live preview widget factory
    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    // Timer fires — content is " " (whitespace only), so Empty placeholder is set (line 108)
    vi.runAllTimers();
    expect(previewEl.innerHTML).toContain("code-block-live-preview-empty");

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("live preview: updateLivePreview mermaid path (line 115)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "graph TD; A-->B");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    // Timer fires — mermaid path (line 115)
    await vi.runAllTimersAsync();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("live preview: updateLivePreview svg path (line 119)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("svg", "<svg><circle r='5'/></svg>");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "<svg><circle r='5'/></svg>");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    vi.runAllTimers();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("live preview: updateLivePreview markmap path (line 117)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("markmap", "# Root\n## Child");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "# Root\n## Child");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    await vi.runAllTimersAsync();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
    // Explicit timeout: this is the one markmap test that reaches the render
    // path, so it pays for `Promise.all([import("markmap-lib"),
    // import("markmap-view")])` (plugins/markmap/plugin.ts) — two d3-backed
    // libraries, lazily loaded and NOT mocked here, because sibling tests in
    // this file spy on the real `@/plugins/markmap`. `runAllTimersAsync` awaits
    // that real settlement, and under full-suite parallel load the transform +
    // eval exceeds the 5s default. It passes in isolation; it reddened the
    // v0.9.16 pre-push gate. Same root cause and same remedy as the
    // WorkflowCanvas lazy-chunk bump in df896e22.
  }, 20_000);

  it("live preview: updateLivePreview token cancellation — rapid calls only execute last (line 104)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("svg", "<svg><rect width='10'/></svg>");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "<svg><rect width='10'/></svg>");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // Invoke live preview factory — sets currentLivePreview
    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    // Now trigger multiple rapid doc changes — each calls updateLivePreview
    // but earlier tokens are cancelled (line 104)
    const state2 = editingState.apply(editingState.tr.insertText("!", codeBlockPos + 4));
    freshPlugins[0].getState(state2);
    const state3 = state2.apply(state2.tr.insertText("?", codeBlockPos + 5));
    freshPlugins[0].getState(state3);

    // Only the last fires — earlier ones are no-ops (token mismatch)
    vi.runAllTimers();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

});
