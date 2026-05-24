import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the store before importing
vi.mock("@/stores/blockMathEditingStore", () => {
  const state = {
    editingPos: null as number | null,
    originalContent: null as string | null,
    exitEditing: vi.fn(),
    startEditing: vi.fn(),
    isEditingAt: vi.fn(),
  };
  return {
    useBlockMathEditingStore: {
      getState: () => state,
      setState: (partial: Partial<typeof state>) => Object.assign(state, partial),
    },
  };
});

vi.mock("./tiptap", () => ({
  EDITING_STATE_CHANGED: "codePreviewEditingChanged",
}));

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import { blockMathKeymapExtension } from "./blockMathKeymap";

// We can't easily instantiate the Extension, so we test the exported logic indirectly.
// The file exports `blockMathKeymapExtension` which creates a ProseMirror plugin.
// We'll test the plugin's handleKeyDown and handleClick via the extension's plugin.

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: {
      content: "text*",
      group: "block",
      attrs: { language: { default: "" } },
      code: true,
    },
    text: { inline: true },
  },
});

function createDoc(codeContent: string, language = "latex") {
  return schema.node("doc", null, [
    schema.node("codeBlock", { language }, codeContent ? [schema.text(codeContent)] : []),
    schema.node("paragraph", null, []),
  ]);
}

function createEditorState(codeContent: string, language = "latex", cursorPos?: number) {
  const doc = createDoc(codeContent, language);
  const state = EditorState.create({ schema, doc });
  if (cursorPos !== undefined) {
    return state.apply(
      state.tr.setSelection(TextSelection.create(doc, cursorPos))
    );
  }
  return state;
}

function createMockView(state: EditorState): EditorView & { dispatch: ReturnType<typeof vi.fn> } {
  const dispatched: unknown[] = [];
  return {
    state,
    dispatch: vi.fn((tr) => dispatched.push(tr)),
    posAtCoords: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };
}

describe("blockMathKeymap — handleKeyDown drives the plugin", () => {
  // These tests invoke the plugin's handleKeyDown for real and assert the
  // observable side effects (return value, exitEditing call, dispatched
  // transaction shape). Earlier versions only inspected store state and
  // never exercised the plugin code path.

  function buildPlugin() {
    const ctx = {
      name: blockMathKeymapExtension.name,
      options: blockMathKeymapExtension.options,
      storage: blockMathKeymapExtension.storage,
       
      editor: {} as any,
      type: null,
      parent: undefined,
    };
     
    const plugins = (blockMathKeymapExtension.config as any).addProseMirrorPlugins?.call(ctx) ?? [];
    return plugins[0];
  }

  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("returns false when no editing is in progress", () => {
    const state = createEditorState("content");
    const view = createMockView(state);
    const plugin = buildPlugin();
    const result = plugin.props.handleKeyDown!(view, new KeyboardEvent("keydown", { key: "Escape" }));
    expect(result).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(useBlockMathEditingStore.getState().exitEditing).not.toHaveBeenCalled();
  });

  it("Escape reverts edited content back to originalContent", () => {
    const state = createEditorState("modified", "latex");
    const view = createMockView(state);
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "original";

    const plugin = buildPlugin();
    const result = plugin.props.handleKeyDown!(view, new KeyboardEvent("keydown", { key: "Escape" }));

    expect(result).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(store.exitEditing).toHaveBeenCalled();
    // The dispatched transaction should have at least one step that touches
    // the codeBlock content range.
     
    const tr = view.dispatch.mock.calls[0][0] as any;
    expect(tr.steps.length).toBeGreaterThan(0);
  });

  it("Escape with unchanged content clears state without rewriting the doc", () => {
    const state = createEditorState("same", "latex");
    const view = createMockView(state);
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "same";

    const plugin = buildPlugin();
    const result = plugin.props.handleKeyDown!(view, new KeyboardEvent("keydown", { key: "Escape" }));

    expect(result).toBe(true);
    expect(store.exitEditing).toHaveBeenCalled();
    // dispatch is still called (to move the cursor), but no step replaces
    // content because currentContent === originalContent.
     
    const tr = view.dispatch.mock.calls[0][0] as any;
    const hasReplace = tr.steps.some(
      (s: { from?: number; to?: number }) =>
        typeof s.from === "number" && typeof s.to === "number" && s.to > s.from,
    );
    expect(hasReplace).toBe(false);
  });

  it("Cmd+Enter outside the editing codeBlock returns false (no-op)", () => {
    // Cursor in the paragraph after the codeBlock; editingPos still points at
    // the codeBlock. isCursorInCodeBlock should reject and the handler must
    // not commit.
    const doc = createDoc("body", "latex");
    const cursorInPara = doc.firstChild!.nodeSize + 1;
    const state = createEditorState("body", "latex", cursorInPara);
    const view = createMockView(state);
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "body";

    const plugin = buildPlugin();
    const result = plugin.props.handleKeyDown!(
      view,
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
    );

    expect(result).toBe(false);
    expect(store.exitEditing).not.toHaveBeenCalled();
  });

  it("Cmd+Enter inside the editing codeBlock commits (does not revert)", () => {
    const state = createEditorState("edited", "latex", 1); // cursor inside block
    const view = createMockView(state);
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "orig";

    const plugin = buildPlugin();
    const result = plugin.props.handleKeyDown!(
      view,
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
    );

    expect(result).toBe(true);
    expect(store.exitEditing).toHaveBeenCalled();
    // commit path: revert=false so no replaceWith on the codeBlock content.
     
    const tr = view.dispatch.mock.calls[0][0] as any;
    const hasReplace = tr.steps.some(
      (s: { from?: number; to?: number }) =>
        typeof s.from === "number" && typeof s.to === "number" && s.to > s.from,
    );
    expect(hasReplace).toBe(false);
  });
});

describe("blockMathKeymap — cursor detection", () => {
  it("detects cursor inside codeBlock node", () => {
    // doc: codeBlock("hello") + paragraph
    // codeBlock spans pos 0..7 (0=start, 1..6=content, 7=end)
    // cursor at pos 1 is inside the code block
    const state = createEditorState("hello", "latex", 1);
    const { $from } = state.selection;

    let foundCodeBlock = false;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === "codeBlock") {
        foundCodeBlock = true;
        const blockStart = $from.before(depth);
        expect(blockStart).toBe(0);
        break;
      }
    }
    expect(foundCodeBlock).toBe(true);
  });

  it("detects cursor outside codeBlock node", () => {
    // cursor in the paragraph after the code block
    const doc = createDoc("hello", "latex");
    const codeBlockSize = doc.child(0).nodeSize;
    // paragraph starts at codeBlockSize, content at codeBlockSize + 1
    const cursorInParagraph = codeBlockSize + 1;
    const state = createEditorState("hello", "latex", cursorInParagraph);
    const { $from } = state.selection;

    let foundCodeBlock = false;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === "codeBlock") {
        foundCodeBlock = true;
        break;
      }
    }
    expect(foundCodeBlock).toBe(false);
  });
});

describe("blockMathKeymap — empty code block", () => {
  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("handles empty code block content", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "";

    const state = createEditorState("", "latex");
    const node = state.doc.nodeAt(0);
    expect(node).toBeDefined();
    expect(node!.textContent).toBe("");
  });

  it("handles code block with LaTeX special chars", () => {
    const content = "\\int_{0}^{\\infty} e^{-x^2} dx";
    const state = createEditorState(content, "latex");
    const node = state.doc.nodeAt(0);
    expect(node!.textContent).toBe(content);
  });

  it("handles code block with multiline content", () => {
    const content = "a = 1\nb = 2\nc = a + b";
    const state = createEditorState(content, "latex");
    const node = state.doc.nodeAt(0);
    expect(node!.textContent).toBe(content);
  });
});

describe("blockMathKeymap — stale editingPos guard (P4)", () => {
  // Build a real plugin instance and exercise its handleKeyDown so we can
  // verify it does not call replaceWith / does not corrupt the doc when
  // editingPos points at a node that is no longer a codeBlock.
  function buildPlugin() {
    const ctx = {
      name: blockMathKeymapExtension.name,
      options: blockMathKeymapExtension.options,
      storage: blockMathKeymapExtension.storage,
       
      editor: {} as any,
      type: null,
      parent: undefined,
    };
     
    const plugins = (blockMathKeymapExtension.config as any).addProseMirrorPlugins?.call(ctx) ?? [];
    return plugins[0];
  }

  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("does not throw when editingPos points at a paragraph (not a codeBlock)", () => {
    // Doc: codeBlock("orig") + paragraph(""). codeBlock starts at 0; the
    // paragraph starts at codeBlock.nodeSize. Point editingPos at the
    // paragraph — simulating positions shifting out from under us.
    const state = createEditorState("orig", "latex");
    const paragraphPos = state.doc.firstChild!.nodeSize;
    expect(state.doc.nodeAt(paragraphPos)?.type.name).toBe("paragraph");

    const store = useBlockMathEditingStore.getState();
    store.editingPos = paragraphPos;
    store.originalContent = "orig";

    const view = createMockView(state);
    const plugin = buildPlugin();

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    // Must NOT throw "Position N outside of fragment (<paragraph>)".
    expect(() => plugin.props.handleKeyDown!(view, event)).not.toThrow();

    // Plugin must clear store and not dispatch a destructive replaceWith.
    expect(store.exitEditing).toHaveBeenCalled();
    // Either no dispatch, OR a dispatch that does not touch the paragraph.
    for (const tr of view.dispatch.mock.calls.map((c) => c[0])) {
       
      const steps = (tr as any).steps as Array<{ from?: number; to?: number }>;
      for (const step of steps) {
        if (typeof step.from === "number" && typeof step.to === "number") {
          expect(step.to - step.from).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("does not throw when editingPos is past the end of the doc", () => {
    const state = createEditorState("orig", "latex");
    const store = useBlockMathEditingStore.getState();
    store.editingPos = state.doc.content.size + 100;
    store.originalContent = "orig";

    const view = createMockView(state);
    const plugin = buildPlugin();

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    expect(() => plugin.props.handleKeyDown!(view, event)).not.toThrow();
    expect(store.exitEditing).toHaveBeenCalled();
  });
});

describe("blockMathKeymap — extension structure", () => {
  it("has the correct name", async () => {
    const { blockMathKeymapExtension } = await import("./blockMathKeymap");
    expect(blockMathKeymapExtension.name).toBe("blockMathKeymap");
  });

  it("defines ProseMirror plugins", async () => {
    const { blockMathKeymapExtension } = await import("./blockMathKeymap");
    expect(blockMathKeymapExtension.config.addProseMirrorPlugins).toBeDefined();
  });
});

describe("blockMathKeymap — store integration", () => {
  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("store tracks editing position and original content", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 5;
    store.originalContent = "\\frac{1}{2}";

    expect(store.editingPos).toBe(5);
    expect(store.originalContent).toBe("\\frac{1}{2}");
  });

  it("exitEditing is callable", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 5;
    store.exitEditing();
    expect(store.exitEditing).toHaveBeenCalledTimes(1);
  });
});

describe("blockMathKeymap — plugin handleKeyDown", () => {
  function getPlugin() {
    // Dynamically import to get a fresh extension with fresh closure state
    const ext = compositionGuardFreeExtension();
    const plugins = ext.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "blockMathKeymap",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    return plugins[0];
  }

  // We import the extension directly since the mock is already set up
  function compositionGuardFreeExtension() {
    return blockMathKeymapExtension;
  }

  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("handleKeyDown returns false when editingPos is null", () => {
    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("hello", "latex", 1);
    const view = createMockView(state);

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(result).toBe(false);
  });

  it("handleKeyDown Escape exits editing when content matches (no revert needed)", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "same";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("same", "latex", 1);
    const view = createMockView(state);

    const preventDefault = vi.fn();
    const result = handleKeyDown(view, { key: "Escape", preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(store.exitEditing).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("handleKeyDown Cmd+Enter commits (no revert) when cursor is in code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "content";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    // cursor at pos 1 is inside the code block at editingPos 0
    const state = createEditorState("content", "latex", 1);
    const view = createMockView(state);

    const preventDefault = vi.fn();
    const result = handleKeyDown(view, { key: "Enter", metaKey: true, ctrlKey: false, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(store.exitEditing).toHaveBeenCalled();
    // dispatch should have been called (commit without revert)
    expect(view.dispatch).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("handleKeyDown Ctrl+Enter commits when cursor is in code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "content";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("content", "latex", 1);
    const view = createMockView(state);

    const preventDefault = vi.fn();
    const result = handleKeyDown(view, { key: "Enter", metaKey: false, ctrlKey: true, preventDefault });

    expect(result).toBe(true);
    expect(store.exitEditing).toHaveBeenCalled();
  });

  it("handleKeyDown Enter (without meta) returns false when cursor is in code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "original";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("modified", "latex", 1);
    const view = createMockView(state);

    const result = handleKeyDown(view, { key: "Enter", metaKey: false, ctrlKey: false, preventDefault: vi.fn() });
    expect(result).toBe(false);
  });

  it("handleKeyDown non-Escape key returns false when cursor is outside code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "original";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    // Put cursor in the paragraph after the code block
    const doc = createDoc("hello", "latex");
    const codeBlockSize = doc.child(0).nodeSize;
    const cursorInParagraph = codeBlockSize + 1;
    const state = createEditorState("hello", "latex", cursorInParagraph);
    const view = createMockView(state);

    const result = handleKeyDown(view, { key: "Enter", metaKey: true, ctrlKey: false, preventDefault: vi.fn() });
    expect(result).toBe(false);
  });

  it("exitEditing handles null originalContent (no revert path)", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = null;

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("content", "latex", 1);
    const view = createMockView(state);

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(result).toBe(true);
    // originalContent is null so no revert happens even though revert=true
    expect(store.exitEditing).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("exitEditing returns false when node at editingPos is null (lines 58-60)", () => {
    const store = useBlockMathEditingStore.getState();
    store.originalContent = "hello";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    // Create a state and find a position where nodeAt returns null
    const state = createEditorState("hello", "latex", 1);

    // Use a mock view where state.doc.nodeAt always returns null for editingPos
    const mockState = {
      ...state,
      doc: {
        ...state.doc,
        nodeAt: () => null,
        resolve: state.doc.resolve.bind(state.doc),
        content: state.doc.content,
      },
      tr: state.tr,
    };
    store.editingPos = 0;

    const view = {
      state: mockState,
      dispatch: vi.fn(),
      posAtCoords: vi.fn(),
    } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(store.exitEditing).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("exitEditing reverts content when revert=true and content differs (lines 70-72)", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "original";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("modified", "latex", 1);
    // Create a mock transaction that chains properly without doc validation
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
      get doc() { return state.doc; },
    };
    const mockState = {
      ...state,
      tr: mockTr,
      schema: state.schema,
      doc: state.doc,
    };
    const view = {
      state: mockState,
      dispatch: vi.fn(),
      posAtCoords: vi.fn(),
    } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(result).toBe(true);
    expect(store.exitEditing).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
    // Verify replaceWith was called (the revert path, lines 70-72)
    expect(mockTr.replaceWith).toHaveBeenCalledWith(1, 9, expect.anything());
  });

  it("exitEditing handles same content (no replaceWith needed)", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "same";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    const state = createEditorState("same", "latex", 1);
    const view = createMockView(state);

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(result).toBe(true);
    expect(store.exitEditing).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("exitEditing uses empty fragment when originalContent is empty string (line 72 [] branch)", () => {
    // When originalContent is "" (falsy), the ternary uses [] instead of schema.text("")
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "";

    const plugin = getPlugin();
    const handleKeyDown = (plugin as { props: { handleKeyDown: (view: unknown, event: unknown) => boolean } }).props.handleKeyDown;

    // Code block currently has "modified" content, but originalContent is ""
    // So revert=true and currentContent !== originalContent → uses []
    const state = createEditorState("modified", "latex", 1);
    const mockTr = {
      replaceWith: vi.fn().mockReturnThis(),
      setSelection: vi.fn().mockReturnThis(),
      setMeta: vi.fn().mockReturnThis(),
      get doc() { return state.doc; },
    };
    const mockState = {
      ...state,
      tr: mockTr,
      schema: state.schema,
      doc: state.doc,
    };
    const view = {
      state: mockState,
      dispatch: vi.fn(),
      posAtCoords: vi.fn(),
    } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };

    const result = handleKeyDown(view, { key: "Escape", preventDefault: vi.fn() });
    expect(result).toBe(true);
    // replaceWith should be called with [] (empty array) because originalContent is ""
    expect(mockTr.replaceWith).toHaveBeenCalledWith(1, 9, []);
    expect(store.exitEditing).toHaveBeenCalled();
  });
});

describe("blockMathKeymap — plugin handleClick", () => {
  function getPlugin() {
    return blockMathKeymapExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "blockMathKeymap",
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never)[0];
  }

  beforeEach(() => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = null;
    store.originalContent = null;
    vi.mocked(store.exitEditing).mockClear();
  });

  it("handleClick returns false when not editing", () => {
    const plugin = getPlugin();
    const handleClick = (plugin as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;

    const state = createEditorState("hello", "latex", 1);
    const view = createMockView(state);

    const result = handleClick(view, 1, { clientX: 100, clientY: 100 });
    expect(result).toBe(false);
  });

  it("handleClick reverts when clicking outside the code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    // Use same content so replaceWith is skipped (avoids position mismatch)
    store.originalContent = "content";

    const plugin = getPlugin();
    const handleClick = (plugin as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;

    // doc: codeBlock("content") + paragraph
    const doc = createDoc("content", "latex");
    const codeBlockSize = doc.child(0).nodeSize;
    const cursorInParagraph = codeBlockSize + 1;
    const state = createEditorState("content", "latex", cursorInParagraph);
    const view = createMockView(state);
    // posAtCoords returns position outside the code block
    (view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue({ pos: cursorInParagraph });

    const result = handleClick(view, cursorInParagraph, { clientX: 100, clientY: 100 });
    // Should revert and return false (don't prevent default click)
    expect(result).toBe(false);
    expect(store.exitEditing).toHaveBeenCalled();
  });

  it("handleClick does nothing when clicking inside the code block", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "content";

    const plugin = getPlugin();
    const handleClick = (plugin as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;

    const state = createEditorState("content", "latex", 2);
    const view = createMockView(state);
    // posAtCoords returns position inside the code block
    (view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue({ pos: 2 });

    const result = handleClick(view, 2, { clientX: 100, clientY: 100 });
    expect(result).toBe(false);
    expect(store.exitEditing).not.toHaveBeenCalled();
  });

  it("handleClick exits editing when node at editingPos is null (lines 130-131)", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "hello";

    const plugin = getPlugin();
    const handleClick = (plugin as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;

    const state = createEditorState("hello", "latex", 1);
    // Mock state.doc.nodeAt to return null
    const mockState = {
      ...state,
      doc: {
        ...state.doc,
        nodeAt: () => null,
        content: state.doc.content,
      },
    };
    const view = {
      state: mockState,
      dispatch: vi.fn(),
      posAtCoords: vi.fn(),
    } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };

    const result = handleClick(view, 1, { clientX: 100, clientY: 100 });
    expect(result).toBe(false);
    expect(store.exitEditing).toHaveBeenCalled();
  });

  it("handleClick returns false when posAtCoords returns null", () => {
    const store = useBlockMathEditingStore.getState();
    store.editingPos = 0;
    store.originalContent = "content";

    const plugin = getPlugin();
    const handleClick = (plugin as { props: { handleClick: (view: unknown, pos: number, event: unknown) => boolean } }).props.handleClick;

    const state = createEditorState("content", "latex", 1);
    const view = createMockView(state);
    (view.posAtCoords as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = handleClick(view, 0, { clientX: 100, clientY: 100 });
    expect(result).toBe(false);
  });
});
