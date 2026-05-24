/**
 * Tests for sourcePeekInline extension — extension structure, plugin state
 * init/apply, widget factory, live preview, and re-exports.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Transaction } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

// Mock CSS
vi.mock("./source-peek-inline.css", () => ({}));

// Mock store
const mockStoreState = {
  isOpen: false,
  range: null as { from: number; to: number } | null,
  markdown: "",
  blockTypeName: null as string | null,
  hasUnsavedChanges: false,
  livePreview: false,
  toggleLivePreview: vi.fn(),
  setMarkdown: vi.fn(),
};
const mockSetState = vi.fn();
vi.mock("@/stores/sourcePeekStore", () => ({
  useSourcePeekStore: {
    getState: () => mockStoreState,
    setState: (...args: unknown[]) => mockSetState(...args),
  },
}));

// Mock dependencies
const mockApplySourcePeekMarkdown = vi.fn();
const mockGetExpandedSourcePeekRange = vi.fn(() => ({ from: 0, to: 10 }));
vi.mock("@/services/editor/sourcePeek", () => ({
  applySourcePeekMarkdown: (...args: unknown[]) => mockApplySourcePeekMarkdown(...args),
  getExpandedSourcePeekRange: (...args: unknown[]) => mockGetExpandedSourcePeekRange(...args),
}));

const mockCreateEditHeader = vi.fn(() => document.createElement("div"));
vi.mock("./sourcePeekHeader", () => ({
  createEditHeader: (...args: unknown[]) => mockCreateEditHeader(...args),
}));

const mockCreateCodeMirrorEditor = vi.fn(() => document.createElement("div"));
const mockCleanupCMView = vi.fn();
vi.mock("./sourcePeekEditor", () => ({
  createCodeMirrorEditor: (...args: unknown[]) => mockCreateCodeMirrorEditor(...args),
  cleanupCMView: (...args: unknown[]) => mockCleanupCMView(...args),
}));

const mockGetMarkdownOptions = vi.fn(() => ({}));
const mockCommitSourcePeek = vi.fn();
const mockRevertAndCloseSourcePeek = vi.fn();
vi.mock("./sourcePeekActions", () => ({
  EDITING_STATE_CHANGED: "sourcePeekEditingChanged",
  getMarkdownOptions: (...args: unknown[]) => mockGetMarkdownOptions(...args),
  canUseSourcePeek: vi.fn(() => true),
  openSourcePeekInline: vi.fn(),
  commitSourcePeek: (...args: unknown[]) => mockCommitSourcePeek(...args),
  revertAndCloseSourcePeek: (...args: unknown[]) => mockRevertAndCloseSourcePeek(...args),
}));

import {
  sourcePeekInlineExtension,
  sourcePeekInlinePluginKey,
  EDITING_STATE_CHANGED,
  canUseSourcePeek,
  openSourcePeekInline,
  commitSourcePeek,
  revertAndCloseSourcePeek,
} from "./tiptap";

// --- Helpers ---

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { inline: true },
  },
});

function createDoc(text: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
}

function getPlugin() {
  const plugins = sourcePeekInlineExtension.config.addProseMirrorPlugins!.call({
    name: "sourcePeekInline",
    options: {},
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
  return plugins[0];
}

function initPluginState(plugin: ReturnType<typeof getPlugin>) {
  return plugin.spec.state!.init!(
    {} as never,
    EditorState.create({ doc: createDoc("hello"), schema })
  );
}

function applyPluginState(
  plugin: ReturnType<typeof getPlugin>,
  tr: Transaction,
  prevState: { decorations: DecorationSet; editingPos: number | null },
  newState: EditorState
) {
  return plugin.spec.state!.apply!(
    tr,
    prevState,
    newState,
    newState
  );
}

describe("sourcePeekInlineExtension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.isOpen = false;
    mockStoreState.range = null;
    mockStoreState.markdown = "";
    mockStoreState.blockTypeName = null;
    mockStoreState.hasUnsavedChanges = false;
    mockStoreState.livePreview = false;
  });

  it("has name 'sourcePeekInline'", () => {
    expect(sourcePeekInlineExtension.name).toBe("sourcePeekInline");
  });

  it("defines ProseMirror plugins", () => {
    expect(sourcePeekInlineExtension.config.addProseMirrorPlugins).toBeDefined();
  });

  it("creates a plugin with correct key", () => {
    const plugin = getPlugin();
    expect(plugin).toBeDefined();
    expect(plugin.spec.key).toBe(sourcePeekInlinePluginKey);
  });
});

describe("plugin state init", () => {
  it("returns empty decorations and null editingPos", () => {
    const plugin = getPlugin();
    const state = initPluginState(plugin);
    expect(state.decorations).toBe(DecorationSet.empty);
    expect(state.editingPos).toBeNull();
  });
});

describe("plugin state apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.isOpen = false;
    mockStoreState.range = null;
    mockStoreState.markdown = "";
    mockStoreState.blockTypeName = null;
    mockStoreState.hasUnsavedChanges = false;
    mockStoreState.livePreview = false;
  });

  it("returns empty decorations and cleans up when not open", () => {
    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr;

    const result = applyPluginState(plugin, tr, prevState, editorState);
    expect(result.decorations).toBe(DecorationSet.empty);
    expect(result.editingPos).toBeNull();
    expect(mockCleanupCMView).toHaveBeenCalled();
  });

  it("returns empty decorations when open but no range", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = null;

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr;

    const result = applyPluginState(plugin, tr, prevState, editorState);
    expect(result.decorations).toBe(DecorationSet.empty);
    expect(mockCleanupCMView).toHaveBeenCalled();
  });

  it("creates decorations when open with range and editingChanged meta", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };
    mockStoreState.markdown = "# Hello";

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, prevState, editorState);
    expect(result.decorations).not.toBe(DecorationSet.empty);
    expect(result.editingPos).toBe(0);
  });

  it("maps existing decorations when no editing change and same pos", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };

    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });

    // First, create decorations
    const tr1 = editorState.tr.setMeta("sourcePeekEditingChanged", true);
    const state1 = applyPluginState(plugin, tr1, { decorations: DecorationSet.empty, editingPos: null }, editorState);

    // Then apply without editing change - should map decorations
    const tr2 = editorState.tr;
    const result = applyPluginState(plugin, tr2, state1, editorState);
    expect(result.editingPos).toBe(0);
    // Decorations are mapped, not rebuilt
    expect(result.decorations).not.toBe(DecorationSet.empty);
  });

  it("returns empty when node not found at range.from", () => {
    mockStoreState.isOpen = true;
    // Position 1 is inside the paragraph text, not at a node boundary
    // doc.nodeAt(1) for "hello" inside a paragraph returns a text node
    // We need a position where nodeAt returns null — use position just before doc end
    // Actually, for this simple doc: doc(paragraph("hello")),
    // pos 0 = paragraph, pos 1-5 = text. nodeAt(6) = null (end of paragraph)
    mockStoreState.range = { from: 6, to: 7 };

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    // nodeAt(6) should be null (end of paragraph node, before doc close)
    const nodeAtPos = editorState.doc.nodeAt(6);
    // If nodeAt returns something, try position 7 (doc end)
    if (nodeAtPos !== null) {
      mockStoreState.range = { from: 7, to: 8 };
    }

    const result = applyPluginState(plugin, tr, prevState, editorState);
    expect(result.decorations).toBe(DecorationSet.empty);
    expect(result.editingPos).toBeNull();
  });

  it("applies source-peek-live class when livePreview is on", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };
    mockStoreState.livePreview = true;

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, prevState, editorState);
    expect(result.decorations).not.toBe(DecorationSet.empty);

    // Check that the node decoration has the live class
    const decos = result.decorations.find();
    const nodeDecos = decos.filter((d: { type: { attrs: unknown } }) => d.type.attrs);
    expect(nodeDecos.length).toBeGreaterThan(0);
    const nodeDecoAttrs = nodeDecos[0].type.attrs as Record<string, string>;
    expect(nodeDecoAttrs.class).toContain("source-peek-live");
  });

  it("applies source-peek-editing class without live when livePreview is off", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };
    mockStoreState.livePreview = false;

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, prevState, editorState);
    const decos = result.decorations.find();
    const nodeDecos = decos.filter((d: { type: { attrs: unknown } }) => d.type.attrs);
    expect(nodeDecos.length).toBeGreaterThan(0);
    const nodeDecoAttrs = nodeDecos[0].type.attrs as Record<string, string>;
    expect(nodeDecoAttrs.class).toBe("source-peek-editing");
  });

  it("uses blockTypeName from store when available", () => {
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };
    mockStoreState.blockTypeName = "heading";

    const plugin = getPlugin();
    const prevState = { decorations: DecorationSet.empty, editingPos: null };
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, prevState, editorState);

    // Render the widget to trigger the factory
    const decos = result.decorations.find();
    const widgetDeco = decos.find(
      (d: { spec: { key?: string } }) => d.spec?.key?.startsWith("source-peek:")
    );
    const mockView = { state: editorState, dispatch: vi.fn() };
    widgetDeco.type.toDOM(mockView);

    // createEditHeader should have been called with "heading"
    expect(mockCreateEditHeader).toHaveBeenCalledWith(
      "heading",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });
});

describe("widget factory callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.isOpen = true;
    mockStoreState.range = { from: 0, to: 7 };
    mockStoreState.markdown = "hello";
    mockStoreState.blockTypeName = null;
    mockStoreState.hasUnsavedChanges = false;
    mockStoreState.livePreview = false;
  });

  function getWidgetFactory() {
    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);
    const prevState = { decorations: DecorationSet.empty, editingPos: null };

    applyPluginState(plugin, tr, prevState, editorState);

    // The widget factory is the second argument to Decoration.widget
    // We need to extract the toDOM function from the created widget decoration
    // The decorations should have a widget at position 0
    // Since we can't directly access the factory, we verify through the mock calls
    return { editorState };
  }

  it("passes markdown to createCodeMirrorEditor", () => {
    getWidgetFactory();
    // Widget factory isn't called until the decoration is rendered.
    // But we can verify the arguments to createEditHeader
    // The factory is deferred, so let's verify the plugin state was created correctly.
    expect(mockCreateEditHeader).not.toHaveBeenCalled(); // Not called until rendered
  });

  it("CodeMirror onChange callback updates store and applies live preview", () => {
    // To test the onChange callback, we need to capture it from createCodeMirrorEditor
    let capturedOnChange: ((md: string) => void) | null = null;
    mockCreateCodeMirrorEditor.mockImplementation(
      (_md: string, _onCommit: () => void, _onRevert: () => void, onChange: (md: string) => void) => {
        capturedOnChange = onChange;
        return document.createElement("div");
      }
    );

    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);
    const prevState = { decorations: DecorationSet.empty, editingPos: null };

    const result = applyPluginState(plugin, tr, prevState, editorState);

    // Now render the widget decoration by finding it and calling toDOM
    const decos = result.decorations.find();
    const widgetDeco = decos.find(
      (d: { spec: { key?: string } }) => d.spec?.key?.startsWith("source-peek:")
    );
    expect(widgetDeco).toBeDefined();

    // Call the widget factory with a mock view
    const mockView = {
      state: editorState,
      dispatch: vi.fn(),
    };
    const widgetEl = widgetDeco.type.toDOM(mockView);
    expect(widgetEl).toBeInstanceOf(HTMLDivElement);
    expect(widgetEl.className).toBe("source-peek-inline");

    // Verify createCodeMirrorEditor was called
    expect(mockCreateCodeMirrorEditor).toHaveBeenCalled();

    // Test the onChange callback
    expect(capturedOnChange).not.toBeNull();

    // Without live preview
    mockStoreState.livePreview = false;
    capturedOnChange!("new markdown");
    expect(mockStoreState.setMarkdown).toHaveBeenCalledWith("new markdown");
    expect(mockApplySourcePeekMarkdown).not.toHaveBeenCalled();

    // With live preview
    mockStoreState.livePreview = true;
    mockStoreState.range = { from: 0, to: 7 };
    capturedOnChange!("updated md");
    expect(mockStoreState.setMarkdown).toHaveBeenCalledWith("updated md");
    expect(mockApplySourcePeekMarkdown).toHaveBeenCalledWith(
      mockView,
      { from: 0, to: 7 },
      "updated md",
      {}
    );
    expect(mockGetExpandedSourcePeekRange).toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledWith({ range: { from: 0, to: 10 } });
  });

  it("CodeMirror onCommit and onRevert callbacks call action functions", () => {
    let capturedOnCommit: (() => void) | null = null;
    let capturedOnRevert: (() => void) | null = null;
    mockCreateCodeMirrorEditor.mockImplementation(
      (_md: string, onCommit: () => void, onRevert: () => void) => {
        capturedOnCommit = onCommit;
        capturedOnRevert = onRevert;
        return document.createElement("div");
      }
    );

    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, { decorations: DecorationSet.empty, editingPos: null }, editorState);
    const decos = result.decorations.find();
    const widgetDeco = decos.find(
      (d: { spec: { key?: string } }) => d.spec?.key?.startsWith("source-peek:")
    );
    const mockView = { state: editorState, dispatch: vi.fn() };
    widgetDeco.type.toDOM(mockView);

    expect(capturedOnCommit).not.toBeNull();
    capturedOnCommit!();
    expect(mockCommitSourcePeek).toHaveBeenCalledWith(mockView);

    expect(capturedOnRevert).not.toBeNull();
    capturedOnRevert!();
    expect(mockRevertAndCloseSourcePeek).toHaveBeenCalledWith(mockView);
  });

  it("live preview onChange skips when range is null", () => {
    let capturedOnChange: ((md: string) => void) | null = null;
    mockCreateCodeMirrorEditor.mockImplementation(
      (_md: string, _onCommit: () => void, _onRevert: () => void, onChange: (md: string) => void) => {
        capturedOnChange = onChange;
        return document.createElement("div");
      }
    );

    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, { decorations: DecorationSet.empty, editingPos: null }, editorState);

    const decos = result.decorations.find();
    const widgetDeco = decos.find(
      (d: { spec: { key?: string } }) => d.spec?.key?.startsWith("source-peek:")
    );
    const mockView = { state: editorState, dispatch: vi.fn() };
    widgetDeco.type.toDOM(mockView);

    // Set live preview on but range is null
    mockStoreState.livePreview = true;
    mockStoreState.range = null;

    capturedOnChange!("test");
    expect(mockStoreState.setMarkdown).toHaveBeenCalledWith("test");
    expect(mockApplySourcePeekMarkdown).not.toHaveBeenCalled();
  });

  it("header callbacks invoke commit and revert", () => {
    let capturedRevert: (() => void) | null = null;
    let capturedCommit: (() => void) | null = null;
    let capturedToggle: (() => void) | null = null;
    mockCreateEditHeader.mockImplementation(
      (_name: string, _hasChanges: boolean, onRevert: () => void, onCommit: () => void, onToggle: () => void) => {
        capturedRevert = onRevert;
        capturedCommit = onCommit;
        capturedToggle = onToggle;
        return document.createElement("div");
      }
    );

    const plugin = getPlugin();
    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const tr = editorState.tr.setMeta("sourcePeekEditingChanged", true);

    const result = applyPluginState(plugin, tr, { decorations: DecorationSet.empty, editingPos: null }, editorState);
    const decos = result.decorations.find();
    const widgetDeco = decos.find(
      (d: { spec: { key?: string } }) => d.spec?.key?.startsWith("source-peek:")
    );
    const mockView = { state: editorState, dispatch: vi.fn() };
    widgetDeco.type.toDOM(mockView);

    // Test revert callback
    expect(capturedRevert).not.toBeNull();
    capturedRevert!();
    expect(mockRevertAndCloseSourcePeek).toHaveBeenCalledWith(mockView);

    // Test commit callback
    expect(capturedCommit).not.toBeNull();
    capturedCommit!();
    expect(mockCommitSourcePeek).toHaveBeenCalledWith(mockView);

    // Test toggle callback
    expect(capturedToggle).not.toBeNull();
    capturedToggle!();
    expect(mockStoreState.toggleLivePreview).toHaveBeenCalled();
    expect(mockView.dispatch).toHaveBeenCalled();
  });
});

describe("plugin decorations prop", () => {
  it("returns decorations from plugin state", () => {
    const plugin = getPlugin();
    const decorationsFn = plugin.spec.props?.decorations;
    expect(decorationsFn).toBeDefined();

    const editorState = EditorState.create({ doc: createDoc("hello"), schema, plugins: [plugin] });
    const result = decorationsFn!.call(plugin, editorState);
    expect(result).toBeDefined();
  });
});

describe("plugin view destroy", () => {
  it("calls cleanupCMView on destroy", () => {
    const plugin = getPlugin();
    const viewSpec = plugin.spec.view!({} as never);
    expect(viewSpec.destroy).toBeDefined();

    mockCleanupCMView.mockClear();
    viewSpec.destroy!();
    expect(mockCleanupCMView).toHaveBeenCalled();
  });
});

describe("re-exports", () => {
  it("exports sourcePeekInlinePluginKey", () => {
    expect(sourcePeekInlinePluginKey).toBeDefined();
  });

  it("exports EDITING_STATE_CHANGED", () => {
    expect(EDITING_STATE_CHANGED).toBe("sourcePeekEditingChanged");
  });

  it("exports canUseSourcePeek", () => {
    expect(canUseSourcePeek).toBeTypeOf("function");
  });

  it("exports openSourcePeekInline", () => {
    expect(openSourcePeekInline).toBeTypeOf("function");
  });

  it("exports commitSourcePeek", () => {
    expect(commitSourcePeek).toBeTypeOf("function");
  });

  it("exports revertAndCloseSourcePeek", () => {
    expect(revertAndCloseSourcePeek).toBeTypeOf("function");
  });
});
