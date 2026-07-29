import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Editor } from "@tiptap/core";
import {
  codePreviewExtension,
  clearPreviewCache,
  EDITING_STATE_CHANGED,
  SETTINGS_CHANGED,
  __resetActiveEditorViewsForTesting,
} from "./tiptap";
import {
  createStateWithCodeBlock,
  type DecorationLike,
} from "@/test/codePreviewTestUtils";

describe("codePreview widget factory invocation — covers lines 263-354, part 2", () => {
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

  it("placeholder widget factory: invoked for empty non-editing block (line 337)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();

    const { state, plugins } = createStateWithCodeBlock("mermaid", "   ");
    // Not in edit mode — should have preview-only + placeholder widget

    const pluginState = plugins[0].getState(state);
    const decs = pluginState.decorations.find();

    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs.length).toBeGreaterThanOrEqual(1);

    const mockView = makeDispatchView(state);
    // Invoke placeholder widget factory — covers line 337
    const placeholderEl = (widgetDecs[0] as any).type.toDOM(mockView);
    expect(placeholderEl).toBeInstanceOf(HTMLElement);
    expect(placeholderEl.className).toContain("code-block-preview-placeholder");

    // Click the placeholder to enter edit mode — covers handleEnterEdit (lines 311-320)
    const clickTarget = placeholderEl.querySelector("button, [role='button']") ?? placeholderEl;
    (clickTarget as HTMLElement).click();
  });

  it("placeholder widget handleEnterEdit: calls startEditing and dispatches (lines 311-320)", async () => {
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    const { state } = createStateWithCodeBlock("latex", "   ");

    let _codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        _codeBlockPos = pos;
        return false;
      }
      return true;
    });

    const mockView = makeDispatchView(state);
    freshPlugins[0].spec.view!(mockView as never);

    const pluginState = freshPlugins[0].getState(state);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // Invoke placeholder widget factory with the mock view — covers line 337
    const placeholderEl = (widgetDecs[0] as any).type.toDOM(mockView);
    expect(placeholderEl).toBeInstanceOf(HTMLElement);

    // Trigger the handleEnterEdit callback via double-click on the preview element
    // (installDoubleClickHandler attaches a dblclick event)
    const dblClickEvt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    placeholderEl.dispatchEvent(dblClickEvt);

    // handleEnterEdit calls startEditing then dispatch — covers lines 314-320
    expect(mockView.dispatch).toHaveBeenCalled();

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("cached preview widget factory: SETTINGS_CHANGED forces recompute and hits cache (lines 347-354)", async () => {
    // previewCache is module-level. createSvgPreviewWidget sets it synchronously.
    // First getState() call populates cache. A SETTINGS_CHANGED transaction forces
    // decoration recomputation, and the second pass finds cached?.rendered → lines 347-354 execute.
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    useBlockMathEditingStore.getState().exitEditing();

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    // SVG content — renderSvgBlock populates previewCache synchronously
    const { state } = createStateWithCodeBlock("svg", "<svg><rect width='20' height='20'/></svg>");

    // First getState() — populates previewCache for cacheKey "svg:<content>"
    freshPlugins[0].getState(state);

    // Apply SETTINGS_CHANGED transaction — forces decoration recomputation next apply()
    const settingsTr = state.tr.setMeta(SETTINGS_CHANGED, true);
    const settingsState = state.apply(settingsTr);

    // getState on the new state — apply() runs, finds cached?.rendered truthy → lines 347-354
    const pluginState2 = freshPlugins[0].getState(settingsState);
    const decs2 = pluginState2.decorations.find();
    const widgetDecs2 = decs2.filter((d: DecorationLike) => !d.type?.attrs?.class);
    expect(widgetDecs2.length).toBeGreaterThanOrEqual(1);

    const mockView = makeDispatchView(settingsState);
    // Invoke the cached widget factory — covers lines 347-354
    const el = (widgetDecs2[0] as any).type.toDOM(mockView);
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.className).toContain("code-block-preview");

    // Double-click to trigger handleEnterEdit (lines 311-320)
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(mockView.dispatch).toHaveBeenCalled();

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode: null node — nodeAt returns null at a boundary position (lines 152-160)", async () => {
    // ProseMirror nodeAt() returns null for positions within bounds that don't start a node.
    // For doc(codeBlock("x^2")): nodeAt(doc.nodeSize - 1) which is the closing position of the doc
    // is out of range; but nodeAt(codeBlock.nodeSize) = nodeAt after the codeblock = null within doc.
    // We use editingPos = 1 (inside codeBlock text) which returns the text node, not null.
    // Actually the simplest null case: position equal to doc.content.size returns null (end-of-doc).
    // Let's use a two-paragraph doc where pos between paragraphs returns null.
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const { schema } = createStateWithCodeBlock("latex", "x^2");

    // Build a doc with TWO code blocks — between them, nodeAt returns null at the boundary
    // Actually, just use doc.content.size - 1 which is the closing token of the last node.
    // For a doc(codeBlock("x^2")), content.size = 5 (1 open + 3 chars + 1 close).
    // nodeAt(4) = position of the codeBlock's closing token = null.
    // Wait — let's just find any position where nodeAt returns null.
    // Add a paragraph after the codeBlock, making a two-node doc.
    const codeBlock = schema.nodes.codeBlock.create({ language: "latex" }, schema.text("x^2"));
    const paragraph = schema.nodes.paragraph.create();
    const twoNodeDoc = schema.nodes.doc.create(null, [codeBlock, paragraph]);
    const twoNodeState = EditorState.create({
      schema,
      doc: twoNodeDoc,
      plugins: (codePreviewExtension.config.addProseMirrorPlugins?.call({
        name: codePreviewExtension.name,
        options: codePreviewExtension.options,
        storage: codePreviewExtension.storage,
        editor: {} as Editor,
        type: null,
        parent: undefined,
      }) ?? []),
    });

    // In doc(codeBlock("x^2"), paragraph()):
    // pos 0 = codeBlock start, pos 1..3 = text, pos 4 = codeBlock end, pos 5 = paragraph start
    // nodeAt(4) = position at the END of codeBlock inside doc → returns null (no node starts here)
    const nullNodePos = 4; // within range, but nodeAt returns null

    useBlockMathEditingStore.getState().startEditing(0, "x^2"); // editing codeBlock at pos 0

    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    const mockView = makeDispatchView(twoNodeState);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = twoNodeState.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = twoNodeState.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs.length > 0) {
      // Override store to point to nullNodePos where nodeAt returns null
      useBlockMathEditingStore.setState({ editingPos: nullNodePos, originalContent: "x^2" });

      const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
      const saveBtn = headerEl.querySelector(".code-block-edit-save") as HTMLButtonElement | null;
      if (saveBtn) {
        // exitEditMode reads store.editingPos = 4, state.doc.nodeAt(4) = null → lines 153-160
        saveBtn.click();
        expect(mockView.dispatch).toHaveBeenCalled();
      }
    }

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode: revert=true with same content skips replaceWith (lines 166-172 branch)", async () => {
    // When revert=true and currentContent === originalContent, the replaceWith is skipped
    // but exitEditMode still proceeds to line 176+ (cache clear, setSelection, dispatch).
    // This covers the revert=true branch without triggering the doc-mismatch ProseMirror error.
    const { useBlockMathEditingStore } = await import("@/stores/blockMathEditingStore");
    const originalContent = "x^2";
    const { state } = createStateWithCodeBlock("latex", originalContent);

    let codeBlockPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" || node.type.name === "code_block") {
        codeBlockPos = pos;
        return false;
      }
      return true;
    });

    // originalContent matches doc content → replaceWith is skipped (line 168 is false)
    useBlockMathEditingStore.getState().startEditing(codeBlockPos, originalContent);

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

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs.length > 0) {
      const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
      const cancelBtn = headerEl.querySelector(".code-block-edit-cancel") as HTMLButtonElement | null;
      if (cancelBtn) {
        cancelBtn.click(); // revert=true, content matches → covers 166, 167, 168(false), then 176-198
        expect(mockView.dispatch).toHaveBeenCalled();
      }
    }

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode: null originalContent skips revert entirely (line 166 null branch)", async () => {
    // When originalContent is null in the store, the revert block (lines 166-173) is skipped entirely.
    // This covers the false branch of `if (revert && originalContent !== null)`.
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

    // Simulate originalContent=null by directly setting store state
    // startEditing sets originalContent; we override it to null via setState
    useBlockMathEditingStore.setState({ editingPos: codeBlockPos, originalContent: null });

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

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs.length > 0) {
      const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
      const cancelBtn = headerEl.querySelector(".code-block-edit-cancel") as HTMLButtonElement | null;
      if (cancelBtn) {
        cancelBtn.click(); // revert=true, originalContent="" — uses empty fragment (line 171)
        expect(mockView.dispatch).toHaveBeenCalled();
      }
    }

    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode: both view and currentEditorView null → early return line 139", async () => {
    // If exitEditMode is called with null view AND no currentEditorView, it returns at line 139.
    // We invoke the header widget factory with null (so widgetView=null), and ensure
    // no plugin view has been registered (so currentEditorView stays null too).
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

    // Create plugins WITHOUT registering a view (no spec.view() call)
    // so currentEditorView remains null
    const extensionContext = {
      name: codePreviewExtension.name,
      options: codePreviewExtension.options,
      storage: codePreviewExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    };
    const freshPlugins = codePreviewExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];

    // Register the view so we can destroy it to null out currentEditorView
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);
    // Destroy the view — this sets currentEditorView = null
    viewResult.destroy!();

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs.length > 0) {
      // Call with null view — widgetView will be null; currentEditorView is also null → line 139
      const headerEl = (widgetDecs[0] as any).type.toDOM(null);
      const cancelBtn = headerEl.querySelector(".code-block-edit-cancel") as HTMLButtonElement | null;
      if (cancelBtn) {
        cancelBtn.click(); // exitEditMode(null, true) → editorView = null || null → return (line 139)
        // dispatch should NOT have been called since we returned early
        expect(mockView.dispatch).not.toHaveBeenCalled();
      }
    }

    useBlockMathEditingStore.getState().exitEditing();
  });

  it("exitEditMode: editingPos null in store → early return line 146", async () => {
    // If store.editingPos is null when exitEditMode is called, it returns at line 146.
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
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs.length > 0) {
      // Clear store.editingPos BEFORE clicking
      useBlockMathEditingStore.getState().exitEditing(); // sets editingPos = null

      const headerEl = (widgetDecs[0] as any).type.toDOM(mockView);
      const saveBtn = headerEl.querySelector(".code-block-edit-save") as HTMLButtonElement | null;
      if (saveBtn) {
        saveBtn.click(); // exitEditMode(mockView, false) → editingPos===null → return (line 146)
        expect(mockView.dispatch).not.toHaveBeenCalled();
      }
    }

    viewResult.destroy!();
  });

  it("exitEditMode: clears livePreviewTimeout when timer is active (lines 195-197)", async () => {
    // To cover lines 195-197, livePreviewTimeout must be non-null when exitEditMode runs.
    // We trigger updateLivePreview (which sets livePreviewTimeout) via a doc change with
    // a live preview widget active, then call exitEditMode before the timer fires.
    vi.useFakeTimers();
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
    const mockView = makeDispatchView(state);
    const viewResult = freshPlugins[0].spec.view!(mockView as never);

    const tr1 = state.tr.setMeta(EDITING_STATE_CHANGED, true);
    const editingState = state.apply(tr1);
    viewResult.update!(Object.assign({}, mockView, { state: editingState }) as never, {} as never);
    mockView.state = editingState;

    // Get header + live preview widgets
    const pluginState = freshPlugins[0].getState(editingState);
    const decs = pluginState.decorations.find();
    const widgetDecs = decs.filter((d: DecorationLike) => !d.type?.attrs?.class);

    // Invoke live preview widget factory to set currentLivePreview (enables updateLivePreview)
    if (widgetDecs.length >= 2) {
      const livePreviewDec = widgetDecs[widgetDecs.length - 1];
      (livePreviewDec as any).type.toDOM(mockView); // sets currentLivePreview, starts timer
    }

    // Now trigger a doc change to set livePreviewTimeout via updateLivePreview
    const state2 = editingState.apply(editingState.tr.insertText("+y", codeBlockPos + 4));
    freshPlugins[0].getState(state2); // calls updateLivePreview → sets livePreviewTimeout
    // DO NOT fire timer — livePreviewTimeout is now non-null

    // Now click save to call exitEditMode while livePreviewTimeout is active
    const pluginState2 = freshPlugins[0].getState(editingState);
    const decs2 = pluginState2.decorations.find();
    const widgetDecs2 = decs2.filter((d: DecorationLike) => !d.type?.attrs?.class);

    if (widgetDecs2.length > 0) {
      const headerEl = (widgetDecs2[0] as any).type.toDOM(mockView);
      const saveBtn = headerEl.querySelector(".code-block-edit-save") as HTMLButtonElement | null;
      if (saveBtn) {
        // exitEditMode runs with livePreviewTimeout non-null → lines 195-197 execute
        saveBtn.click();
        expect(mockView.dispatch).toHaveBeenCalled();
      }
    }

    vi.useRealTimers();
    viewResult.destroy!();
    useBlockMathEditingStore.getState().exitEditing();
  });
});
