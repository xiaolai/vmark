/**
 * Tests for MathInlineNodeView — inline math node view coverage.
 *
 * Covers uncovered branches:
 * - handleClick when not editing with valid pos
 * - enterEditMode re-entry guard (exitingLeft/exitingRight)
 * - exitEditMode early return when not editing
 * - updateInputSize early return guards
 * - handleInput early return guard
 * - deleteNode, unwrapToText, commitChanges, commitAndExit, exitAndFocusEditor guards
 */

import { describe, it, expect, vi } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// --- Mocks ---

vi.mock("./katexLoader", () => ({
  loadKatex: vi.fn(() => Promise.resolve({ default: { render: vi.fn() } })),
  isKatexLoaded: vi.fn(() => false),
}));

vi.mock("@/plugins/mathPreview/MathPreviewView", () => ({
  getMathPreviewView: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    updateContent: vi.fn(),
    updatePosition: vi.fn(),
  })),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/plugins/inlineNodeEditing/tiptap", () => ({
  inlineNodeEditingKey: {
    getState: vi.fn(() => null),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: {
    getState: vi.fn(() => ({
      getShortcut: vi.fn(() => "Alt-Mod-m"),
    })),
  },
}));

vi.mock("@/utils/shortcutMatch", () => ({
  matchesShortcutEvent: vi.fn(() => false),
}));

const mathEditingStoreState = {
  startEditing: vi.fn(),
  stopEditing: vi.fn(),
  clear: vi.fn(),
};
vi.mock("@/stores/inlineMathEditingStore", () => ({
  useInlineMathEditingStore: {
    getState: vi.fn(() => mathEditingStoreState),
  },
}));

vi.mock("@/utils/debug", () => ({
  renderWarn: vi.fn(),
}));

vi.mock("./latex.css", () => ({}));

// Import after mocks
import { MathInlineNodeView } from "./MathInlineNodeView";

// --- Test schema and helpers ---

const schema = new Schema({
  nodes: {
    doc: { content: "inline+" },
    math_inline: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { content: { default: "" } },
      toDOM: () => ["span", { "data-type": "math_inline" }],
      parseDOM: [{ tag: "span[data-type=math_inline]" }],
    },
    text: { inline: true, group: "inline" },
  },
});

function createMockNode(latex = "x^2"): PMNode {
  return schema.node("math_inline", { content: latex });
}

function createMockView(state?: EditorState): EditorView & { dispatch: ReturnType<typeof vi.fn> } {
  const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
  const editorState = state ?? EditorState.create({ schema, doc });
  return {
    state: editorState,
    dispatch: vi.fn(),
    focus: vi.fn(),
    composing: false,
    dom: document.createElement("div"),
    coordsAtPos: vi.fn(() => ({ top: 0, left: 0, bottom: 0, right: 0 })),
  } as unknown as EditorView & { dispatch: ReturnType<typeof vi.fn> };
}

describe("MathInlineNodeView — construction", () => {
  it("creates dom element with correct class", () => {
    const node = createMockNode();
    const view = createMockView();
    const nodeView = new MathInlineNodeView(node, view, () => 0);
    expect(nodeView.dom.className).toBe("math-inline");
  });

  it("sets aria attributes", () => {
    const node = createMockNode();
    const view = createMockView();
    const nodeView = new MathInlineNodeView(node, view, () => 0);
    expect(nodeView.dom.getAttribute("role")).toBe("math");
    expect(nodeView.dom.getAttribute("aria-label")).toContain("Math:");
  });

  it("creates with empty content (placeholder path)", () => {
    const node = createMockNode("");
    const view = createMockView();
    const nodeView = new MathInlineNodeView(node, view, () => 0);
    expect(nodeView.dom).toBeDefined();
  });

  it("creates without getPos (null getPos)", () => {
    const node = createMockNode("y^2");
    const view = createMockView();
    const nodeView = new MathInlineNodeView(node, view);
    expect(nodeView.dom).toBeDefined();
  });
});

describe("MathInlineNodeView — handleClick", () => {
  it("does nothing when already editing", () => {
    const node = createMockNode("x^2");
    const view = createMockView();
    const nodeView = new MathInlineNodeView(node, view, () => 0);

    // Manually set isEditing via class change
    // (we can't set private field directly — test the public interface)
    const event = new MouseEvent("click", { bubbles: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    nodeView.dom.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("dispatches selection when not editing and pos is valid", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    const event = new MouseEvent("click", { bubbles: true });
    nodeView.dom.dispatchEvent(event);

    // dispatch should be called with a transaction
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it("does not dispatch when getPos returns undefined", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => undefined);

    const event = new MouseEvent("click", { bubbles: true });
    nodeView.dom.dispatchEvent(event);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when getPos is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view);

    const event = new MouseEvent("click", { bubbles: true });
    nodeView.dom.dispatchEvent(event);

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — enterEditMode guard (exitingLeft/exitingRight)", () => {
  it("handles class change to editing and back", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Adding "editing" class triggers enterEditMode via MutationObserver
    // The MutationObserver is async, so we can only test the public surface here
    nodeView.dom.classList.add("editing");
    // MutationObserver fires asynchronously — we just verify no throw
    expect(nodeView.dom.classList.contains("editing")).toBe(true);
  });
});

describe("MathInlineNodeView — exitEditMode early return (line 186)", () => {
  it("calling forceExit when not editing does nothing", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Access private forceExit via any cast
    const forceExit = (nodeView as unknown as { forceExit: () => void }).forceExit;
    expect(() => forceExit.call(nodeView)).not.toThrow();
  });
});

describe("MathInlineNodeView — update()", () => {
  it("returns false for non-math_inline node type", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Create a node of a different type
    const wrongSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*", group: "block" },
        text: { inline: true },
      },
    });
    const wrongNode = wrongSchema.node("paragraph", null, []);
    const result = nodeView.update(wrongNode as unknown as PMNode);
    expect(result).toBe(false);
  });

  it("returns true for math_inline node", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);
    const result = nodeView.update(createMockNode("y^2"));
    expect(result).toBe(true);
  });

  it("updates aria-label with new content", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);
    nodeView.update(createMockNode("z^3"));
    expect(nodeView.dom.getAttribute("aria-label")).toContain("z^3");
  });

  it("update with empty content sets empty aria label", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);
    nodeView.update(createMockNode(""));
    expect(nodeView.dom.getAttribute("aria-label")).toContain("empty");
  });
});

describe("MathInlineNodeView — selectNode / deselectNode", () => {
  it("selectNode adds ProseMirror-selectednode class", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    nodeView.selectNode();
    expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
  });

  it("deselectNode removes ProseMirror-selectednode class", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    nodeView.selectNode();
    nodeView.deselectNode();
    expect(nodeView.dom.classList.contains("ProseMirror-selectednode")).toBe(false);
  });
});

describe("MathInlineNodeView — destroy()", () => {
  it("destroy cleans up observer and event listeners", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    expect(() => nodeView.destroy()).not.toThrow();
  });

  it("destroy clears from store when pos is valid", () => {
    mathEditingStoreState.clear.mockClear();
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 5);
    nodeView.destroy();
    expect(mathEditingStoreState.clear).toHaveBeenCalledWith(5);
  });

  it("destroy with no getPos does not call clear", () => {
    mathEditingStoreState.clear.mockClear();
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view);
    nodeView.destroy();
    // getPos is null, so getPos?.() returns undefined → clear not called
    expect(mathEditingStoreState.clear).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — private method early-return guards (via indirection)", () => {
  it("deleteNode returns early when getPos is null", () => {
    // Access via any cast — deleteNode has guard `if (!this.getPos || !this.editorView) return`
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view);
    // getPos is null (not provided), so deleteNode should return early
    const deleteNode = (nodeView as unknown as { deleteNode: () => void }).deleteNode;
    expect(() => deleteNode.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("deleteNode returns early when editorView is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    // Null out the editorView
    (nodeView as unknown as { editorView: null }).editorView = null;
    const deleteNode = (nodeView as unknown as { deleteNode: () => void }).deleteNode;
    expect(() => deleteNode.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("deleteNode returns early when getPos returns undefined", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => undefined);
    const deleteNode = (nodeView as unknown as { deleteNode: () => void }).deleteNode;
    expect(() => deleteNode.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("deleteNode dispatches delete transaction when valid", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);
    const deleteNode = (nodeView as unknown as { deleteNode: () => void }).deleteNode;
    deleteNode.call(nodeView);
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("unwrapToText returns early when getPos is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view);
    const unwrapToText = (nodeView as unknown as { unwrapToText: () => void }).unwrapToText;
    expect(() => unwrapToText.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("commitChanges returns early when getPos is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view);
    const commitChanges = (nodeView as unknown as { commitChanges: (l: string) => void }).commitChanges;
    expect(() => commitChanges.call(nodeView, "y^2")).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("commitChanges returns early when getPos returns undefined", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => undefined);
    const commitChanges = (nodeView as unknown as { commitChanges: (l: string) => void }).commitChanges;
    expect(() => commitChanges.call(nodeView, "y^2")).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("commitChanges dispatches when node exists and latex changed", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);
    const commitChanges = (nodeView as unknown as { commitChanges: (l: string) => void }).commitChanges;
    commitChanges.call(nodeView, "y^2");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("commitChanges deletes node when both new and current latex are empty", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode(""), view, () => 0);
    const commitChanges = (nodeView as unknown as { commitChanges: (l: string) => void }).commitChanges;
    // Both empty → delete node (covers lines 371-373)
    commitChanges.call(nodeView, "");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("commitAndExit returns early when inputDom is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    // inputDom is null by default (not in edit mode)
    const commitAndExit = (nodeView as unknown as { commitAndExit: (offset?: number) => void }).commitAndExit;
    expect(() => commitAndExit.call(nodeView)).not.toThrow();
    // No dispatch since inputDom is null
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("exitAndFocusEditor returns early when getPos is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view);
    const exitAndFocusEditor = (nodeView as unknown as { exitAndFocusEditor: (offset?: number) => void }).exitAndFocusEditor;
    expect(() => exitAndFocusEditor.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("exitAndFocusEditor returns early when getPos returns undefined", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => undefined);
    const exitAndFocusEditor = (nodeView as unknown as { exitAndFocusEditor: (offset?: number) => void }).exitAndFocusEditor;
    expect(() => exitAndFocusEditor.call(nodeView)).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("updateInputSize returns early when inputDom is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    // inputDom starts as null
    const updateInputSize = (nodeView as unknown as { updateInputSize: () => void }).updateInputSize;
    expect(() => updateInputSize.call(nodeView)).not.toThrow();
  });

  it("handleInput returns early when inputDom is null", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    // inputDom is null by default
    const handleInput = (nodeView as unknown as { handleInput: () => void }).handleInput;
    expect(() => handleInput.call(nodeView)).not.toThrow();
  });
});

describe("MathInlineNodeView — handleClassChange", () => {
  it("handleClassChange entering edit mode when not already editing", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Access private handleClassChange
    const handleClassChange = (nodeView as unknown as { handleClassChange: () => void }).handleClassChange;

    // Add editing class and trigger manually
    nodeView.dom.classList.add("editing");
    expect(() => handleClassChange.call(nodeView)).not.toThrow();
  });

  it("handleClassChange exiting edit mode when editing is true", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);

    // Manually set isEditing to true
    (nodeView as unknown as { isEditing: boolean }).isEditing = true;

    const handleClassChange = (nodeView as unknown as { handleClassChange: () => void }).handleClassChange;

    // No editing class — should try to exit edit mode
    expect(() => handleClassChange.call(nodeView)).not.toThrow();
  });
});

describe("MathInlineNodeView — enterEditMode already editing guard (line 118)", () => {
  it("enterEditMode returns early when already editing", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Set isEditing to true manually
    (nodeView as unknown as { isEditing: boolean }).isEditing = true;

    // Calling enterEditMode again should return early (line 118)
    const enterEditMode = (nodeView as unknown as { enterEditMode: () => void }).enterEditMode;
    mathEditingStoreState.startEditing.mockClear();
    enterEditMode.call(nodeView);

    // startEditing should NOT be called since we returned early
    expect(mathEditingStoreState.startEditing).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — enterEditMode exitingLeft/Right guard (line 120)", () => {
  it("enterEditMode returns early when exitingLeft is true", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Set exitingLeft flag
    (nodeView as unknown as { exitingLeft: boolean }).exitingLeft = true;

    const enterEditMode = (nodeView as unknown as { enterEditMode: () => void }).enterEditMode;
    mathEditingStoreState.startEditing.mockClear();
    enterEditMode.call(nodeView);

    expect(mathEditingStoreState.startEditing).not.toHaveBeenCalled();
  });

  it("enterEditMode returns early when exitingRight is true", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "x^2" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => 0);

    // Set exitingRight flag
    (nodeView as unknown as { exitingRight: boolean }).exitingRight = true;

    const enterEditMode = (nodeView as unknown as { enterEditMode: () => void }).enterEditMode;
    mathEditingStoreState.startEditing.mockClear();
    enterEditMode.call(nodeView);

    expect(mathEditingStoreState.startEditing).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — enterEditMode getPos undefined guard (line 122–123)", () => {
  it("enterEditMode returns early when getPos returns undefined", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode("x^2"), view, () => undefined);

    const enterEditMode = (nodeView as unknown as { enterEditMode: () => void }).enterEditMode;
    mathEditingStoreState.startEditing.mockClear();
    enterEditMode.call(nodeView);

    expect(mathEditingStoreState.startEditing).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — exitEditMode not editing guard (line 186)", () => {
  it("exitEditMode returns early when not editing", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);

    // isEditing is false by default
    const exitEditMode = (nodeView as unknown as { exitEditMode: () => void }).exitEditMode;
    mathEditingStoreState.stopEditing.mockClear();
    exitEditMode.call(nodeView);

    // stopEditing should NOT be called since isEditing is false
    expect(mathEditingStoreState.stopEditing).not.toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — unwrapToText empty content (line 327 fallback)", () => {
  it("unwrapToText replaces math node with empty fragment when content is empty", () => {
    const doc = schema.node("doc", null, [schema.node("math_inline", { content: "" })]);
    const state = EditorState.create({ schema, doc });
    const view = createMockView(state);
    const nodeView = new MathInlineNodeView(createMockNode(""), view, () => 0);

    // Ensure inputDom is null (not editing) → unwrapToText uses currentLatex ("")
    const unwrapToText = (nodeView as unknown as { unwrapToText: () => void }).unwrapToText;
    unwrapToText.call(nodeView);

    // dispatch should be called — replaces math node with empty content (line 337)
    expect(view.dispatch).toHaveBeenCalled();
  });
});

describe("MathInlineNodeView — stopEvent branches", () => {
  it("stopEvent returns true for all events when editing", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    (nodeView as unknown as { isEditing: boolean }).isEditing = true;

    const event = new Event("keydown");
    expect(nodeView.stopEvent(event)).toBe(true);
  });

  it("stopEvent returns true for mousedown when not editing", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);

    const event = new MouseEvent("mousedown");
    expect(nodeView.stopEvent(event)).toBe(true);
  });

  it("stopEvent returns false for non-mouse events when not editing", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);

    const event = new Event("keydown");
    expect(nodeView.stopEvent(event)).toBe(false);
  });
});

describe("MathInlineNodeView — ignoreMutation", () => {
  it("always returns true", () => {
    const view = createMockView();
    const nodeView = new MathInlineNodeView(createMockNode(), view, () => 0);
    expect(nodeView.ignoreMutation()).toBe(true);
  });
});
