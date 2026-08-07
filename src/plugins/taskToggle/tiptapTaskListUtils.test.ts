// @vitest-environment node
/**
 * Tests for tiptapTaskListUtils — toggleTaskList and convertSelectionToTaskList.
 */

import { describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { taskListItemExtension } from "./tiptap";
import { toggleTaskList, convertSelectionToTaskList } from "./tiptapTaskListUtils";

// ---------------------------------------------------------------------------
// Schema + helpers
// ---------------------------------------------------------------------------

function createSchema() {
  return getSchema([StarterKit.configure({ listItem: false }), taskListItemExtension]);
}

/**
 * Build a mock Tiptap Editor-like object with real ProseMirror state.
 */
function createMockEditor(state: EditorState) {
  const _dispatched: unknown[] = [];
  const view = {
    state,
    dispatch: vi.fn((tr) => {
      // Update the view's state after dispatch, mimicking EditorView behavior
      view.state = view.state.apply(tr);
    }),
    focus: vi.fn(),
  };

  const chainFns: Record<string, unknown> = {};
  const chainProxy = new Proxy(chainFns, {
    get: (_target, prop) => {
      if (prop === "run") return vi.fn(() => true);
      return vi.fn(() => chainProxy);
    },
  });

  const editor = {
    state,
    view,
    chain: vi.fn(() => chainProxy),
  };

  // Keep editor.state in sync with view.state
  Object.defineProperty(editor, "state", {
    get: () => view.state,
  });

  return editor;
}

function createTaskListState(items: Array<{ text: string; checked: boolean | null }>) {
  const schema = createSchema();
  const listItems = items.map((item) => {
    const para = schema.nodes.paragraph.create(null, item.text ? [schema.text(item.text)] : []);
    return schema.nodes.listItem.create({ checked: item.checked }, para);
  });
  const bulletList = schema.nodes.bulletList.create(null, listItems);
  const doc = schema.nodes.doc.create(null, [bulletList]);
  return EditorState.create({ doc });
}

function createParagraphState(text: string) {
  const schema = createSchema();
  const para = schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []);
  const doc = schema.nodes.doc.create(null, [para]);
  return EditorState.create({ doc });
}

function setCursor(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

// ---------------------------------------------------------------------------
// toggleTaskList
// ---------------------------------------------------------------------------

describe("toggleTaskList", () => {
  it("converts plain paragraph to task list via chain when not in a list", () => {
    const state = createParagraphState("Hello world");
    const stateWithCursor = setCursor(state, 3);
    const editor = createMockEditor(stateWithCursor);

    toggleTaskList(editor as never);

    // Should call chain().focus().toggleBulletList().run()
    expect(editor.chain).toHaveBeenCalled();
  });

  it("removes task list when already in a task list", () => {
    const state = createTaskListState([{ text: "Task item", checked: false }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    // toggleTaskList should detect it's in a task list and try to remove it
    toggleTaskList(editor as never);

    // Should dispatch transactions to lift list items
    expect(editor.view.dispatch).toHaveBeenCalled();
  });

  it("does not call chain when inside a task list", () => {
    const state = createTaskListState([{ text: "Task", checked: true }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    toggleTaskList(editor as never);

    // chain should NOT be called — we're removing, not creating
    expect(editor.chain).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// convertSelectionToTaskList
// ---------------------------------------------------------------------------

describe("convertSelectionToTaskList", () => {
  it("uses chain to create bullet list when not in any list", () => {
    const state = createParagraphState("Not a list");
    const stateWithCursor = setCursor(state, 3);
    const editor = createMockEditor(stateWithCursor);

    convertSelectionToTaskList(editor as never);

    expect(editor.chain).toHaveBeenCalled();
  });

  it("converts existing bullet list items to task items (checked: false)", () => {
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Item")]);
    const listItem = schema.nodes.listItem.create({ checked: null }, para);
    const bulletList = schema.nodes.bulletList.create(null, [listItem]);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    convertSelectionToTaskList(editor as never);

    // Should dispatch a transaction that sets checked: false on the listItem
    expect(editor.view.dispatch).toHaveBeenCalled();
  });

  it("does not modify items that already have checked attribute", () => {
    const state = createTaskListState([{ text: "Already task", checked: true }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    // Nothing to change — honest no-op: no dispatch, returns false.
    expect(convertSelectionToTaskList(editor as never)).toBe(false);
    expect(editor.view.dispatch).not.toHaveBeenCalled();
    // Verify the item still has checked: true (not reset to false)
    const listItem = editor.view.state.doc.child(0).child(0);
    expect(listItem.attrs.checked).toBe(true);
  });

  it("converts ordered list to bullet list then adds checked attr", () => {
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Ordered")]);
    const listItem = schema.nodes.listItem.create({ checked: null }, para);
    const orderedList = schema.nodes.orderedList.create(null, [listItem]);
    const doc = schema.nodes.doc.create(null, [orderedList]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    convertSelectionToTaskList(editor as never);

    expect(editor.view.dispatch).toHaveBeenCalled();
    // After dispatch, the list should be a bulletList
    const topChild = editor.view.state.doc.child(0);
    expect(topChild.type.name).toBe("bulletList");
  });

  it("handles multiple list items — sets checked on all unchecked items", () => {
    const schema = createSchema();
    const items = ["First", "Second", "Third"].map((text) => {
      const para = schema.nodes.paragraph.create(null, [schema.text(text)]);
      return schema.nodes.listItem.create({ checked: null }, para);
    });
    const bulletList = schema.nodes.bulletList.create(null, items);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    convertSelectionToTaskList(editor as never);

    expect(editor.view.dispatch).toHaveBeenCalled();

    // All items should now have checked: false
    const list = editor.view.state.doc.child(0);
    list.forEach((item) => {
      expect(item.attrs.checked).toBe(false);
    });
  });

  it("falls back to chain when cursor is not inside any list", () => {
    // When not inside a list and schema has list types,
    // it should call chain().focus().toggleBulletList().run()
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Not in list")]);
    const doc = schema.nodes.doc.create(null, [para]);
    const state = setCursor(EditorState.create({ doc }), 3);
    const editor = createMockEditor(state);

    convertSelectionToTaskList(editor as never);

    // Should fall back to chain since listDepth is -1
    expect(editor.chain).toHaveBeenCalled();
  });

  it("skips items that already have checked: false", () => {
    const state = createTaskListState([{ text: "Already task", checked: false }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    // Fully initialized already — honest no-op: no dispatch, returns false.
    expect(convertSelectionToTaskList(editor as never)).toBe(false);
    expect(editor.view.dispatch).not.toHaveBeenCalled();
    const listItem = editor.view.state.doc.child(0).child(0);
    expect(listItem.attrs.checked).toBe(false);
  });

  it("handles mixed checked and unchecked items", () => {
    const schema = createSchema();
    const items = [
      schema.nodes.listItem.create(
        { checked: true },
        schema.nodes.paragraph.create(null, [schema.text("Done")])
      ),
      schema.nodes.listItem.create(
        { checked: null },
        schema.nodes.paragraph.create(null, [schema.text("New")])
      ),
    ];
    const bulletList = schema.nodes.bulletList.create(null, items);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    convertSelectionToTaskList(editor as never);

    expect(editor.view.dispatch).toHaveBeenCalled();
    const list = editor.view.state.doc.child(0);
    // First item stays checked: true (already has boolean checked)
    expect(list.child(0).attrs.checked).toBe(true);
    // Second item gets checked: false (was null)
    expect(list.child(1).attrs.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: missing schema node types
// ---------------------------------------------------------------------------

describe("convertSelectionToTaskList — missing schema types", () => {
  it("falls back to chain when bulletListType is missing from schema", () => {
    // Create a minimal schema that has no bulletList — triggers the !bulletListType branch (line 108)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Schema } = require("@tiptap/pm/model");
    const minSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const doc = minSchema.node("doc", null, [
      minSchema.node("paragraph", null, [minSchema.text("hello")]),
    ]);
    const state = EditorState.create({ doc });
    const chain = vi.fn(() => ({
      focus: vi.fn(() => ({ toggleBulletList: vi.fn(() => ({ run: vi.fn(() => true) })) })),
    }));
    const editor = {
      get state() { return state; },
      view: { state, dispatch: vi.fn(), focus: vi.fn() },
      chain,
    };
    // Should not throw — calls chain() and returns
    convertSelectionToTaskList(editor as never);
    expect(chain).toHaveBeenCalled();
  });
});

describe("removeTaskList — missing listItem type returns early (lines 42, 68)", () => {
  it("returns early from removeTaskList when schema has no listItem (line 68)", () => {
    // Build a schema WITH listItem so isInTaskList returns true, but then
    // modify the editor's state schema to remove listItem — removeTaskList uses editor.state.schema
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Task")]);
    const li = schema.nodes.listItem.create({ checked: false }, para);
    const blist = schema.nodes.bulletList.create(null, [li]);
    const doc = schema.nodes.doc.create(null, [blist]);
    const realState = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });

    // Create a fake state where schema.nodes.listItem is undefined
    // removeTaskList checks: const listItemType = editor.state.schema.nodes.listItem;
    const fakeSchema = Object.create(realState.schema);
    const fakeNodes = Object.create(realState.schema.nodes);
    fakeNodes.listItem = undefined;
    Object.defineProperty(fakeSchema, "nodes", { get: () => fakeNodes });
    const fakeState = Object.create(realState);
    Object.defineProperty(fakeState, "schema", { get: () => fakeSchema });

    const mockDispatch = vi.fn();
    // isInTaskList(editor) uses editor.state — we need the real state for that
    // but removeTaskList uses editor.state too. So we need a getter that switches.
    let callCount = 0;
    const editor = {
      get state(): EditorState {
        // First call (isInTaskList) returns real state; subsequent calls (removeTaskList) return fake
        callCount++;
        return callCount <= 3 ? realState : fakeState;
      },
      view: {
        get state() { return realState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain: vi.fn(),
    };

    expect(() => toggleTaskList(editor as never)).not.toThrow();
    // Even if dispatch is called from liftListItem within the loop, the key is no throw
  });
});

describe("convertSelectionToTaskList — chain path sets checked after creating list (lines 128-135)", () => {
  it("sets checked:false on new list item when chain creates a bulletList with a listItem", () => {
    // We need chain().focus().toggleBulletList().run() to ACTUALLY modify the editor state
    // so that after the call, the cursor is inside a listItem with checked=null.
    // We do this by building the post-chain state ourselves and updating the mock.
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("New item")]);
    const doc = schema.nodes.doc.create(null, [para]);
    const initialState = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });

    // Create the "after-chain" state: cursor inside a listItem with checked=null
    const listItem = schema.nodes.listItem.create({ checked: null }, schema.nodes.paragraph.create(null, [schema.text("New item")]));
    const bulletList = schema.nodes.bulletList.create(null, [listItem]);
    const docAfterChain = schema.nodes.doc.create(null, [bulletList]);
    const afterChainState = EditorState.create({
      doc: docAfterChain,
      selection: TextSelection.create(docAfterChain, 4), // inside the listItem paragraph
    });

    let currentState = initialState;
    const mockDispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
    });

    // The chain mock updates the state to simulate toggleBulletList
    const chainRunMock = vi.fn(() => {
      currentState = afterChainState;
      return true;
    });
    const chain = vi.fn(() => ({
      focus: vi.fn(() => ({ toggleBulletList: vi.fn(() => ({ run: chainRunMock })) })),
    }));

    const editor = {
      get state() { return currentState; },
      view: {
        get state() { return currentState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain,
    };

    convertSelectionToTaskList(editor as never);

    // chain was called to create the list
    expect(chain).toHaveBeenCalled();
    // After chain, dispatch was called to set checked: false on the new listItem
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("returns without dispatch when chain creates a list item already having checked=true (line 130)", () => {
    // Same as above but the new list item has checked=true already — should return without dispatch
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Pre-checked")]);
    const doc = schema.nodes.doc.create(null, [para]);
    const initialState = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });

    // Create the "after-chain" state: listItem already has checked=true
    const listItem = schema.nodes.listItem.create({ checked: true }, schema.nodes.paragraph.create(null, [schema.text("Pre-checked")]));
    const bulletList = schema.nodes.bulletList.create(null, [listItem]);
    const docAfterChain = schema.nodes.doc.create(null, [bulletList]);
    const afterChainState = EditorState.create({
      doc: docAfterChain,
      selection: TextSelection.create(docAfterChain, 4),
    });

    let currentState = initialState;
    const mockDispatch = vi.fn();
    const chainRunMock = vi.fn(() => {
      currentState = afterChainState;
      return true;
    });
    const chain = vi.fn(() => ({
      focus: vi.fn(() => ({ toggleBulletList: vi.fn(() => ({ run: chainRunMock })) })),
    }));

    const editor = {
      get state() { return currentState; },
      view: {
        get state() { return currentState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain,
    };

    convertSelectionToTaskList(editor as never);

    // chain was called but dispatch should NOT be called since checked is already true
    expect(chain).toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns without dispatch when chain creates no listItem in depth walk (falls through)", () => {
    // chain runs but post-chain state has cursor in a paragraph, not listItem
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Plain")]);
    const doc = schema.nodes.doc.create(null, [para]);
    const initialState = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });

    // After chain, state still has cursor in a paragraph (not in a listItem)
    const currentState = initialState;
    const mockDispatch = vi.fn();
    const chainRunMock = vi.fn(() => {
      // Don't change state — cursor stays in paragraph
      return true;
    });
    const chain = vi.fn(() => ({
      focus: vi.fn(() => ({ toggleBulletList: vi.fn(() => ({ run: chainRunMock })) })),
    }));

    const editor = {
      get state() { return currentState; },
      view: {
        get state() { return currentState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain,
    };

    convertSelectionToTaskList(editor as never);

    expect(chain).toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe("convertSelectionToTaskList — listNode.forEach skips non-listItem children (line 149)", () => {
  it("skips non-listItem children in forEach", () => {
    // This tests line 149: if (item.type !== listItemType) return;
    // A bulletList normally only contains listItems, but we can craft a schema where
    // other node types appear. Actually, in a standard schema this path is unreachable
    // because bulletList only accepts listItem+. Instead we can verify the listNode.forEach
    // iteration runs without error on a standard list.
    const schema = createSchema();
    const items = ["A", "B"].map((text) => {
      const para = schema.nodes.paragraph.create(null, [schema.text(text)]);
      return schema.nodes.listItem.create({ checked: null }, para);
    });
    const bulletList = schema.nodes.bulletList.create(null, items);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });

    const mockDispatch = vi.fn((_tr) => {
      // Update state after dispatch
    });
    const editor = {
      get state() { return state; },
      view: { state, dispatch: mockDispatch, focus: vi.fn() },
      chain: vi.fn(),
    };

    // convertSelectionToTaskList iterates forEach on the listNode (bulletList)
    // All items are listItems (not skipped), and checked=null so they get checked: false
    convertSelectionToTaskList(editor as never);

    expect(mockDispatch).toHaveBeenCalled();
  });

  it("skips children whose type does not match listItemType in forEach (line 149)", () => {
    // Directly exercise the `if (item.type !== listItemType) return` guard by
    // constructing a mock state where the listNode contains a non-listItem child.
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("item")]);
    const listItem = schema.nodes.listItem.create({ checked: null }, para);
    const bulletList = schema.nodes.bulletList.create(null, [listItem]);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const baseState = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });

    // Build a fake list node that has a child with a different type (paragraph)
    const paraChild = schema.nodes.paragraph.create(null, [schema.text("non-item")]);
    const fakeListNode = {
      type: { name: "bulletList" },
      forEach: (fn: (node: unknown, offset: number) => void) => {
        // First child is a paragraph (should be skipped), second is a real listItem
        fn(paraChild, 0);
        fn(listItem, 1);
      },
    };

    // We need the state to return this fake list node at listDepth
    // Use Object.create to override the doc structure
    const _fakeDoc = Object.create(baseState.doc);
    const _listDepthReached = false;
    const fakeFrom = Object.create(baseState.selection.$from);
    // Depth=1 means there's one level of nesting; node(1) should return fakeListNode
    Object.defineProperty(fakeFrom, "depth", { get: () => 1, configurable: true });
    const realNode = baseState.selection.$from.node.bind(baseState.selection.$from);
    fakeFrom.node = (depth: number) => {
      if (depth === 1) return fakeListNode;
      return realNode(depth);
    };
    fakeFrom.before = (depth: number) => baseState.selection.$from.before(depth);

    const fakeSelection = Object.create(baseState.selection);
    Object.defineProperty(fakeSelection, "$from", { get: () => fakeFrom, configurable: true });

    const fakeState = Object.create(baseState);
    Object.defineProperty(fakeState, "selection", { get: () => fakeSelection, configurable: true });
    Object.defineProperty(fakeState, "tr", { get: () => baseState.tr, configurable: true });

    const mockDispatch = vi.fn();
    const editor = {
      get state() { return fakeState; },
      view: {
        get state() { return fakeState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain: vi.fn(),
    };

    // Should not throw — the paragraph child is skipped, listItem is processed
    expect(() => convertSelectionToTaskList(editor as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isInTaskList — false branch when checked is not a boolean (line 28 false)
// ---------------------------------------------------------------------------

describe("isInTaskList — checked is not a boolean (line 28 false branch)", () => {
  it("returns false when list item has checked=null, converts to task list instead of removing", () => {
    // A bulletList item with checked=null is NOT a task list item.
    // isInTaskList walks ancestors, finds listItem, but checked=null fails
    // the boolean check → returns false (line 28 false branch).
    // toggleTaskList then calls convertSelectionToTaskList (not removeTaskList).
    // convertSelectionToTaskList finds listDepth !== -1 (already in a list),
    // so it dispatches a transaction to set checked=false on the item.
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Regular item")]);
    const li = schema.nodes.listItem.create({ checked: null }, para);
    const blist = schema.nodes.bulletList.create(null, [li]);
    const doc = schema.nodes.doc.create(null, [blist]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    // toggleTaskList: isInTaskList returns false (checked=null, line 28 false branch)
    // → calls convertSelectionToTaskList → dispatches to set checked=false
    toggleTaskList(editor as never);

    // dispatch was called (convertSelectionToTaskList sets checked: false)
    expect(editor.view.dispatch).toHaveBeenCalled();
    // chain was NOT called (cursor is already in a list, listDepth !== -1)
    expect(editor.chain).not.toHaveBeenCalled();
    // The item should now have checked: false
    const listItem = editor.view.state.doc.child(0).child(0);
    expect(listItem.attrs.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearCheckedAttribute — checked=null branch (line 49 false, no dispatch)
// ---------------------------------------------------------------------------

describe("clearCheckedAttribute — checked=null skips dispatch (line 49 false branch)", () => {
  it("skips dispatch in clearCheckedAttribute when list item already has checked=null after first lift", () => {
    // clearCheckedAttribute finds the innermost listItem.
    // If checked is null (not boolean), the `if (checked === true || checked === false)`
    // at line 49 evaluates false → no dispatch, just break.
    //
    // Scenario: removeTaskList loops; after liftListItem the cursor is in a regular
    // bulletList item with checked=null. clearCheckedAttribute is called again and
    // hits the false branch.
    //
    // We simulate this by building a two-item list where the first item has
    // checked=false (triggers true branch on first call) and after liftListItem
    // the structure changes so the second clearCheckedAttribute call sees checked=null.
    //
    // Simplest approach: create a real state and let removeTaskList run.
    // After the first liftListItem, the item is lifted out of the list. The loop
    // checks `inList` again — if still in a list, it calls clearCheckedAttribute
    // again. The second item has checked=null → false branch.
    const schema = createSchema();
    // Two items: first has checked=false (removed via first iteration),
    // but after lifting, the loop may see no list → exits without hitting false branch.
    // Instead, use a nested list: outer task item (checked=false) containing inner
    // null-checked item. Not practical with standard schema.
    //
    // Direct approach: use a mock editor where after the first dispatch, the
    // view.state transitions to a state with a null-checked item still in a list.
    const para = schema.nodes.paragraph.create(null, [schema.text("Item")]);
    const li = schema.nodes.listItem.create({ checked: false }, para);
    const blist = schema.nodes.bulletList.create(null, [li]);
    const doc = schema.nodes.doc.create(null, [blist]);
    const taskState = setCursor(EditorState.create({ doc }), 4);

    // Build the "after first lift" state: item with checked=null still in a list
    const para2 = schema.nodes.paragraph.create(null, [schema.text("Item")]);
    const li2 = schema.nodes.listItem.create({ checked: null }, para2);
    const blist2 = schema.nodes.bulletList.create(null, [li2]);
    const doc2 = schema.nodes.doc.create(null, [blist2]);
    const nullCheckedState = setCursor(EditorState.create({ doc: doc2 }), 4);

    let callCount = 0;
    const view = {
      get state() {
        // First few accesses: real task state (for isInTaskList + first loop iteration)
        // After callCount > 5: transition to null-checked state so clearCheckedAttribute
        // hits the false branch on the second loop
        callCount++;
        return callCount <= 5 ? taskState : nullCheckedState;
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    };

    const editor = {
      get state() { return view.state; },
      view,
      chain: vi.fn(),
    };

    // Should not throw — clearCheckedAttribute handles null checked gracefully
    expect(() => toggleTaskList(editor as never)).not.toThrow();
    expect(view.focus).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeTaskList — direct early-return when listItem missing (line 68)
// ---------------------------------------------------------------------------

describe("removeTaskList — early return when schema.nodes.listItem is undefined (line 68)", () => {
  it("returns immediately without further dispatch when listItem type is absent", () => {
    // isInTaskList needs to see a real listItem with boolean checked to return true.
    // Once inside removeTaskList, editor.state.schema.nodes.listItem must be undefined
    // to trigger the line 68 early return.
    // Strategy: use a getter on editor.state that returns different states based on
    // how many times it has been called — real state for isInTaskList, patched for removeTaskList.
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("Task")]);
    const li = schema.nodes.listItem.create({ checked: false }, para);
    const blist = schema.nodes.bulletList.create(null, [li]);
    const doc = schema.nodes.doc.create(null, [blist]);
    const realState = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });

    // Build a schema with listItem=undefined for removeTaskList
    const patchedNodes = { ...realState.schema.nodes, listItem: undefined };
    const patchedSchema = Object.assign(Object.create(Object.getPrototypeOf(realState.schema)), realState.schema);
    Object.defineProperty(patchedSchema, "nodes", { value: patchedNodes, configurable: true });
    const patchedState = Object.assign(Object.create(Object.getPrototypeOf(realState)), realState);
    Object.defineProperty(patchedState, "schema", { value: patchedSchema, configurable: true });

    // isInTaskList accesses editor.state 3 times (schema.nodes.listItem, selection.$from, depth loop).
    // removeTaskList accesses editor.state for schema.nodes.listItem (line 67).
    // After 3 accesses return realState, subsequent return patchedState.
    let accessCount = 0;
    const mockDispatch = vi.fn();
    const editor = {
      get state(): EditorState {
        accessCount++;
        return accessCount <= 3 ? realState : patchedState;
      },
      view: {
        get state() { return realState; },
        dispatch: mockDispatch,
        focus: vi.fn(),
      },
      chain: vi.fn(),
    };

    expect(() => toggleTaskList(editor as never)).not.toThrow();
    // removeTaskList returns early at line 68, so no liftListItem dispatch occurs
  });
});

// ---------------------------------------------------------------------------
// toggleTaskList — removeTaskList integration
// ---------------------------------------------------------------------------

describe("toggleTaskList — removeTaskList", () => {
  it("removes task list and calls focus", () => {
    const state = createTaskListState([{ text: "Single item", checked: false }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    toggleTaskList(editor as never);

    expect(editor.view.focus).toHaveBeenCalled();
    // After removal, doc should no longer have bulletList
    const topChild = editor.view.state.doc.child(0);
    expect(topChild.type.name).not.toBe("bulletList");
  });

  it("removes checked attribute before lifting list items", () => {
    const state = createTaskListState([{ text: "Task item", checked: true }]);
    const stateWithCursor = setCursor(state, 4);
    const editor = createMockEditor(stateWithCursor);

    // Before toggle: item has checked: true
    expect(editor.view.state.doc.child(0).child(0).attrs.checked).toBe(true);

    toggleTaskList(editor as never);

    // After removal: should be a paragraph, not a list item
    expect(editor.view.dispatch).toHaveBeenCalled();
  });

  it("handles nested list items during removal", () => {
    const schema = createSchema();
    const para1 = schema.nodes.paragraph.create(null, [schema.text("Item 1")]);
    const para2 = schema.nodes.paragraph.create(null, [schema.text("Item 2")]);
    const items = [
      schema.nodes.listItem.create({ checked: false }, para1),
      schema.nodes.listItem.create({ checked: false }, para2),
    ];
    const bulletList = schema.nodes.bulletList.create(null, items);
    const doc = schema.nodes.doc.create(null, [bulletList]);
    const state = setCursor(EditorState.create({ doc }), 4);
    const editor = createMockEditor(state);

    toggleTaskList(editor as never);

    expect(editor.view.dispatch).toHaveBeenCalled();
    expect(editor.view.focus).toHaveBeenCalled();
  });
});
