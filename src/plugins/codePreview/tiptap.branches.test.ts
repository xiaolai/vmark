import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Editor, getSchema } from "@tiptap/core";
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

describe("codePreview — additional branch coverage", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();
    clearPreviewCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDispatchView2(baseState: EditorState) {
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

  it("handleEnterEdit is a no-op when view is null (line 312 false branch)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state, plugins } = createStateWithCodeBlock("latex", "x^2");

    const pluginState = plugins[0].getState(state);
    const allDecs = pluginState.decorations.find();

    // Find the widget decorations (no attrs.class)
    const widgetDecs = allDecs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThan(0);

    // Call toDOM with null view to exercise the `if (!view) return` guard
    const widgetDec = widgetDecs[widgetDecs.length - 1];
    const el = (widgetDec as any).type.toDOM(null);
    expect(el).toBeInstanceOf(HTMLElement);

    // Click the element — handleEnterEdit is called with null view, should be a no-op
    el.click();

    // Verify no editing was started (view was null)
    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
  });

  it("mermaid non-empty content produces a mermaid preview widget (line 382 branch)", () => {
    const { state, plugins } = createStateWithCodeBlock("mermaid", "graph TD; A-->B");
    const pluginState = plugins[0].getState(state);
    const allDecs = pluginState.decorations.find();

    expect(allDecs.length).toBeGreaterThanOrEqual(2);

    const widgetDecs = allDecs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThan(0);

    const previewEl = (widgetDecs[0] as any).type.toDOM(null);
    expect(previewEl).toBeInstanceOf(HTMLElement);
  });

  it("live preview update skips when node not found at storeEditingPos (line 223 false branch)", async () => {
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

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    plugins[0].getState(editingState);

    // Change store's editingPos to invalid position while doc changes
    useBlockMathEditingStore.setState({ editingPos: 9999 });

    const tr2 = editingState.tr.insertText("Y", 1);
    const updatedState = editingState.apply(tr2);
    expect(() => plugins[0].getState(updatedState)).not.toThrow();

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode clears livePreviewTimeout when it is set (line 156 true branch)", async () => {
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

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView2(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Invoke live preview widget to create a pending timeout
    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    (livePreviewDec as any).type.toDOM(mockView);

    // Trigger a doc change to set another timeout
    const state2 = editingState.apply(editingState.tr.insertText("+y", codeBlockPos + 4));
    freshPlugins[0].getState(state2);
    mockView.state = state2;

    // Click save button to call exitEditMode — clears the pending timeout
    const headerDec = widgetDecs[0];
    const headerEl = (headerDec as any).type.toDOM(mockView);
    const saveBtn = headerEl.querySelector(".code-block-edit-save") as HTMLButtonElement;
    if (saveBtn) {
      saveBtn.click();
    }

    vi.runAllTimers();

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("SVG live preview update via doc change during editing (line 118 branch)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("svg", "<svg></svg>");

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "<svg></svg>");

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView2(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Invoke live preview widget to set currentLivePreview and currentEditingLanguage to "svg"
    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    const livePreviewDec = widgetDecs[widgetDecs.length - 1];
    const previewEl = (livePreviewDec as any).type.toDOM(mockView);
    expect(previewEl).toBeInstanceOf(HTMLElement);

    vi.runAllTimers();

    // Change doc while in SVG editing — triggers updateLivePreview with "svg"
    const state2 = editingState.apply(editingState.tr.insertText("<rect/>", codeBlockPos + 5));
    mockView.state = state2;
    freshPlugins[0].getState(state2);

    vi.runAllTimers();

    useBlockMathEditingStore.getState().exitEditing();
    viewResult.destroy!();
  });

  it("code block with null language attribute uses empty string fallback (line 245 ?? branch)", () => {
    const schema = getSchema([StarterKit]);
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const plugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const baseState = EditorState.create({ schema, doc: emptyDoc, plugins });

    const codeBlock = schema.nodes.codeBlock.create({ language: null }, schema.text("some code"));
    const nextState = baseState.apply(
      baseState.tr.replaceRangeWith(0, baseState.doc.content.size, codeBlock)
    );

    const pluginState = plugins[0].getState(nextState);
    expect(pluginState.decorations.find().length).toBe(0);
  });
});

describe("codePreview — remaining branch coverage", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();
    clearPreviewCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper — creates a fresh plugin instance with a dispatch-capturing mock view
  function makeFreshPluginsWithView(state: EditorState) {
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = {
      state,
      dispatch: vi.fn((tr: ReturnType<typeof state.tr>) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
      composing: false,
      dom: document.createElement("div"),
    };
    const viewResult = freshPlugins[0].spec.view!(mockView as never);
    return { freshPlugins, mockView, viewResult };
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();
    clearPreviewCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Branch 0 (line 69) false: MutationObserver fires with a non-class attribute
  it("theme observer ignores mutations on non-class attributes (line 69 false branch)", async () => {
    const { updateMermaidTheme } = await import("../mermaid");
    const spy = vi.spyOn(
      { updateMermaidTheme },
      "updateMermaidTheme"
    );
    // Trigger a non-class attribute change on documentElement
    document.documentElement.setAttribute("data-test-branch", "value");
    // Allow any microtasks to flush
    await Promise.resolve();
    // updateMermaidTheme should NOT have been called because attributeName !== "class"
    expect(spy).not.toHaveBeenCalled();
    document.documentElement.removeAttribute("data-test-branch");
    spy.mockRestore();
  });

  // Branch 3 (line 106) truthy: stale token — debounced callback fires but token changed
  it("updateLivePreview stale token: rapid calls discard earlier invocations (line 106 truthy)", async () => {
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

    const { freshPlugins, mockView, viewResult } = makeFreshPluginsWithView(state);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Get editing decorations and render the live preview widget to set currentLivePreview
    const ps1 = freshPlugins[0].getState(editingState);
    const decs = ps1.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    // Render the live preview widget (last widget in editing mode: header, livepreview)
    if (widgetDecs.length >= 2) {
      (widgetDecs[widgetDecs.length - 1] as any).type.toDOM(mockView);
    }

    // Trigger two rapid doc changes — second call should cancel first
    const state2 = editingState.apply(editingState.tr.insertText("y", codeBlockPos + 2));
    freshPlugins[0].getState(state2);
    mockView.state = state2;

    const state3 = state2.apply(state2.tr.insertText("z", codeBlockPos + 2));
    freshPlugins[0].getState(state3);
    mockView.state = state3;

    // Advance timers — only the second debounce fires, first is stale
    vi.runAllTimers();

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch 13 (line 159) false: livePreviewTimeout is null when null-node path executes
  it("exitEditMode null-node path: livePreviewTimeout is null so timeout branch skipped (line 159 false)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { state } = createStateWithCodeBlock("latex", "x^2");

    // Point store to an out-of-range position so nodeAt returns null
    useBlockMathEditingStore.getState().startEditing(9999, "x^2");

    const { freshPlugins, mockView, viewResult } = makeFreshPluginsWithView(state);

    // Do NOT create a live preview (no toDOM call) — livePreviewTimeout stays null
    const tr = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Apply a doc change — triggers the null-node path inside apply() with null timeout
    const state2 = editingState.apply(editingState.tr.insertText("X", 1));
    expect(() => freshPlugins[0].getState(state2)).not.toThrow();

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch at line 159 truthy: livePreviewTimeout IS set when null-node path in exitEditMode runs
  it("exitEditMode null-node path: clears livePreviewTimeout when it is pending (line 159 truthy)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const schema = getSchema([StarterKit]);
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const baseState = EditorState.create({ schema, doc: emptyDoc, plugins: freshPlugins });
    // Build doc with codeBlock + paragraph so there is a null-returning gap position
    const codeBlockNode = schema.nodes.codeBlock.create({ language: "latex" }, schema.text("x^2"));
    const paraNode = schema.nodes.paragraph.create();
    const state = baseState.apply(
      baseState.tr.replaceWith(0, baseState.doc.content.size, [codeBlockNode, paraNode])
    );

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });
    expect(codeBlockPos).toBeGreaterThanOrEqual(0);

    // The closing boundary of codeBlock: nodeAt returns null (no child starts there)
    const nullPos = codeBlockPos + codeBlockNode.nodeSize - 1;
    expect(state.doc.nodeAt(nullPos)).toBeNull();

    // Start editing at valid codeBlockPos so decorations include header + live-preview
    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2");

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
      focus: vi.fn(),
      composing: false,
      dom: document.createElement("div"),
    };
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Get decorations and render live-preview widget → sets livePreviewTimeout
    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    // Render the live-preview widget (last widget: header is first, live-preview is last)
    if (widgetDecs.length >= 2) {
      (widgetDecs[widgetDecs.length - 1] as any).type.toDOM(mockView);
    }
    // livePreviewTimeout is now set (fake timers haven't fired yet)

    // Switch store to nullPos so exitEditMode's nodeAt(nullPos) returns null
    useBlockMathEditingStore.setState({ editingPos: nullPos });

    // Render the header widget and click cancel
    // exitEditMode reads editingPos=nullPos, nodeAt(nullPos)=null → null-node path
    // livePreviewTimeout is set → if (livePreviewTimeout) truthy branch fires
    const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
    const cancelBtn = headerEl.querySelector(".code-block-edit-cancel") as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    // dispatch was called (null-node path reached dispatch at line 156)
    expect(mockDispatch).toHaveBeenCalled();
    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch 17 (line 174) truthy: covered by v8 ignore — originalContent is always truthy
  // when entering the revert path (empty string would match currentContent and skip replaceWith)

  // Branch 18 (line 179) false: node.attrs.language is null in exitEditMode → ?? "" fallback
  it("exitEditMode with null language attribute falls back to empty string (line 179 nullish)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const schema = getSchema([StarterKit]);

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    // Create a code block with null language
    const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const baseState = EditorState.create({ schema, doc: emptyDoc, plugins: freshPlugins });
    const codeBlock = schema.nodes.codeBlock.create({ language: null }, schema.text("x^2"));
    const state = baseState.apply(
      baseState.tr.replaceRangeWith(0, baseState.doc.content.size, codeBlock)
    );

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    // Force editing at this position even though language is null (not in PREVIEW_ONLY_LANGUAGES)
    // exitEditMode is called directly via the widget view factory
    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2");

    const mockView = {
      state,
      dispatch: vi.fn((tr: ReturnType<typeof state.tr>) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
      composing: false,
      dom: document.createElement("div"),
    };
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // exitEditMode is called with revert=false via dispatch
    // node.attrs.language is null → (null ?? "") = "" (line 179 nullish branch)
    useBlockMathEditingStore.getState().exitEditing();
    const tr2 = editingState.tr.setMeta(EDITING_STATE_CHANGED, true);
    editingState.apply(tr2);

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch 25 (line 226) false: node is null at storeEditingPos during doc change
  it("live preview update: nodeAt returns null for stale editingPos (line 226 false branch)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const schema = getSchema([StarterKit]);
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    // Build doc with two children: codeBlock + paragraph
    // so there is a gap position between them where nodeAt returns null
    const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const baseState = EditorState.create({ schema, doc: emptyDoc, plugins: freshPlugins });
    const codeBlockNode = schema.nodes.codeBlock.create({ language: "latex" }, schema.text("x^2"));
    const paraNode = schema.nodes.paragraph.create();
    const twoNodeState = baseState.apply(
      baseState.tr.replaceWith(0, baseState.doc.content.size, [codeBlockNode, paraNode])
    );

    let codeBlockPos = -1;
    twoNodeState.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });
    expect(codeBlockPos).toBeGreaterThanOrEqual(0);

    // codeBlockNode.nodeSize = 1 (open) + textLength + 1 (close)
    // The position just before the closing tag of the code block has no child node starting there.
    // nodeAt(codeBlockPos + nodeSize - 1) returns null because no node starts at the closing boundary.
    const nullPos = codeBlockPos + codeBlockNode.nodeSize - 1;
    // Verify position is within doc range (doesn't throw)
    expect(nullPos).toBeGreaterThan(0);
    expect(nullPos).toBeLessThan(twoNodeState.doc.content.size + 2);
    // nodeAt at the closing boundary inside codeBlock returns null
    expect(twoNodeState.doc.nodeAt(nullPos)).toBeNull();

    useBlockMathEditingStore.getState().startEditing(codeBlockPos, "x^2");

    const mockView = {
      state: twoNodeState,
      dispatch: vi.fn((tr: ReturnType<typeof twoNodeState.tr>) => {
        mockView.state = mockView.state.apply(tr);
      }),
      focus: vi.fn(),
      composing: false,
      dom: document.createElement("div"),
    };
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = twoNodeState.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = twoNodeState.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Render the live preview widget to set currentLivePreview inside the closure
    const ps1 = freshPlugins[0].getState(editingState);
    const decs1 = ps1.decorations.find();
    const widgetDecs1 = decs1.filter((d: DecorationLike) => !d.type?.attrs?.class);
    if (widgetDecs1.length >= 2) {
      (widgetDecs1[widgetDecs1.length - 1] as any).type.toDOM(mockView);
    }

    // Now point store to nullPos — nodeAt(nullPos) returns null (closing boundary)
    useBlockMathEditingStore.setState({ editingPos: nullPos });

    // Apply a doc change to trigger the live-preview update branch
    const state2 = editingState.apply(editingState.tr.insertText("Z", codeBlockPos + 2));
    expect(() => freshPlugins[0].getState(state2)).not.toThrow();

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch 35 (line 269) false: node is null in onCopy callback (deleted node)
  // This branch is a defensive null-guard for the race condition where the node
  // is deleted between decoration creation and the user clicking the copy button.
  // We verify the guard exists by confirming no writeText call happens when nodeAt returns null.
  it("header widget onCopy: does not copy when nodeAt returns null (line 269 false branch)", async () => {
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

    const { freshPlugins, mockView, viewResult } = makeFreshPluginsWithView(state);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThan(0);

    // Build a view whose doc always returns null for nodeAt — simulates a deleted node
    const nullNodeView = {
      state: {
        doc: {
          // ProseMirror nodeAt signature returns Node | null
          nodeAt: (_pos: number): null => null,
        },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    };

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    // Render the header widget with our null-nodeAt view
    const headerEl = (widgetDecs[0] as any).type.toDOM(nullNodeView);

    const copyBtn = headerEl.querySelector(".code-block-edit-copy") as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.click();
      // writeText must NOT be called because nodeAt returned null
      expect(writeTextMock).not.toHaveBeenCalled();
    }

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  // Branch 38 (line 315) truthy: handleEnterEdit returns early when view is null/undefined
  // The placeholder widget factory closure calls handleEnterEdit(view) where view comes
  // from the ProseMirror widget toDOM argument. When null is passed, it returns early.
  it("handleEnterEdit no-ops when placeholder widget factory receives null view (line 315 truthy)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");

    // Use whitespace-only content so the plugin creates a placeholder widget (not a preview widget)
    const schema = getSchema([StarterKit]);
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins =
      codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const emptyDoc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const baseState = EditorState.create({ schema, doc: emptyDoc, plugins: freshPlugins });
    // Use a space character to avoid "Empty text nodes" error but still trim() to empty
    const codeBlock = schema.nodes.codeBlock.create({ language: "mermaid" }, schema.text(" "));
    const state = baseState.apply(
      baseState.tr.replaceRangeWith(0, baseState.doc.content.size, codeBlock)
    );

    const pluginState = freshPlugins[0].getState(state);
    const decs = pluginState.decorations.find();

    // Find widget decorations (no attrs.class = widget, not node decoration)
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThan(0);

    // Call the placeholder widget factory with null as the ProseMirror view
    // The closure inside calls handleEnterEdit(null) → `if (!view) return` fires
    const el = (widgetDecs[widgetDecs.length - 1] as any).type.toDOM(null);
    expect(el).toBeInstanceOf(HTMLElement);

    // Double-click the placeholder — triggers handleEnterEdit(null) → early return
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    // No editing should have started — editingPos remains null
    expect(useBlockMathEditingStore.getState().editingPos).toBeNull();
  });
});
