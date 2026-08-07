// @vitest-environment node
/**
 * Regression test (audit round 2): wrapping a multi-paragraph selection into
 * a task list must initialize EVERY new listItem with checked:false — not
 * only the item under the cursor. Split from tiptapTaskListUtils.test.ts to
 * keep that file under the test-size gate.
 */
import { describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { taskListItemExtension } from "./tiptap";
import { convertSelectionToTaskList, toggleTaskList } from "./tiptapTaskListUtils";

function createSchema() {
  return getSchema([StarterKit.configure({ listItem: false }), taskListItemExtension]);
}

describe("convertSelectionToTaskList — multi-paragraph wrap", () => {
  it("initializes EVERY new item when wrapping a multi-paragraph selection", () => {
    // Wrapping three paragraphs creates three listItems; all of them must
    // gain checked:false, not only the one under the cursor.
    const schema = createSchema();
    const para = schema.nodes.paragraph.create(null, [schema.text("a")]);
    const doc = schema.nodes.doc.create(null, [para]);
    const initialState = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });

    const items = ["a", "b", "c"].map((t) =>
      schema.nodes.listItem.create(
        { checked: null },
        schema.nodes.paragraph.create(null, [schema.text(t)])
      )
    );
    const bulletList = schema.nodes.bulletList.create(null, items);
    const docAfterChain = schema.nodes.doc.create(null, [bulletList]);
    const afterChainState = EditorState.create({
      doc: docAfterChain,
      selection: TextSelection.create(docAfterChain, 4),
    });

    let currentState = initialState;
    const mockDispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
    });
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

    expect(convertSelectionToTaskList(editor as never)).toBe(true);

    const checkedValues: unknown[] = [];
    currentState.doc.descendants((node) => {
      if (node.type.name === "listItem") checkedValues.push(node.attrs.checked);
    });
    expect(checkedValues).toEqual([false, false, false]);
  });
});

describe("isInTaskList — nearest-list decision", () => {
  it("a plain list NESTED in a task item converts (does not flatten the task)", () => {
    const schema = createSchema();
    const nestedItem = schema.nodes.listItem.create(
      { checked: null },
      schema.nodes.paragraph.create(null, [schema.text("nested")])
    );
    const nestedList = schema.nodes.bulletList.create(null, [nestedItem]);
    const taskItem = schema.nodes.listItem.create({ checked: false }, [
      schema.nodes.paragraph.create(null, [schema.text("task")]),
      nestedList,
    ]);
    const doc = schema.nodes.doc.create(null, [schema.nodes.bulletList.create(null, [taskItem])]);
    // Cursor inside "nested"
    let pos = -1;
    doc.descendants((node, p) => {
      if (node.isText && node.text === "nested") pos = p + 1;
      return true;
    });
    let currentState = EditorState.create({ doc });
    currentState = currentState.apply(
      currentState.tr.setSelection(TextSelection.create(currentState.doc, pos))
    );
    const dispatch = vi.fn((tr) => {
      currentState = currentState.apply(tr);
    });
    const editor = {
      get state() { return currentState; },
      view: {
        get state() { return currentState; },
        dispatch,
        focus: vi.fn(),
      },
      chain: vi.fn(),
    };

    // The nearest item is NOT a task (checked null) — toggling must take the
    // conversion path, initializing the nested item, not flatten the outer
    // task list.
    expect(toggleTaskList(editor as never)).toBe(true);

    const checkedValues: unknown[] = [];
    currentState.doc.descendants((node) => {
      if (node.type.name === "listItem") checkedValues.push(node.attrs.checked);
      return true;
    });
    // Outer task item untouched, nested item initialized.
    expect(checkedValues).toEqual([false, false]);
    let listCount = 0;
    currentState.doc.descendants((node) => {
      if (node.type.name === "bulletList") listCount++;
      return true;
    });
    expect(listCount).toBe(2);
  });
});
