// WI-2.1 / WI-2.4 — WYSIWYG contextmenu trigger: precedence guards
// (defaultPrevented / image target / table position), the
// selection-preserve vs caret-move rule, and store opening with a
// snapshot.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildWysiwygSnapshot: vi.fn(() => ({ surface: "wysiwyg" }) as never),
}));
vi.mock("./snapshot", () => ({ buildWysiwygSnapshot: mocks.buildWysiwygSnapshot }));

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { handleEditorContextMenu, isPosInTable } from "./tiptap";
import { usePopupStore } from "@/stores/popupStore";
import { initialEditorContextMenu } from "@/stores/popupStore/slices";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    table: { group: "block", content: "tableRow+" },
    tableRow: { content: "tableCell+" },
    tableCell: { content: "paragraph+" },
    text: { inline: true },
  },
});

function createState(withTable = false): EditorState {
  const children = [schema.node("paragraph", null, [schema.text("hello world")])];
  if (withTable) {
    children.push(
      schema.node("table", null, [
        schema.node("tableRow", null, [
          schema.node("tableCell", null, [
            schema.node("paragraph", null, [schema.text("cell")]),
          ]),
        ]),
      ])
    );
  }
  return EditorState.create({ doc: schema.node("doc", null, children) });
}

interface FakeView {
  state: EditorState;
  dispatch: (tr: unknown) => void;
  posAtCoords: (coords: { left: number; top: number }) => { pos: number; inside: number } | null;
}

function createView(state: EditorState, posAt: number | null = 3): FakeView {
  const view: FakeView = {
    state,
    dispatch: vi.fn((tr) => {
      view.state = view.state.apply(tr as never);
    }),
    posAtCoords: vi.fn(() => (posAt === null ? null : { pos: posAt, inside: 0 })),
  };
  return view;
}

function contextMenuEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 200,
  });
  Object.assign(event, overrides);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePopupStore.setState({ editorContextMenu: initialEditorContextMenu });
});

describe("handleEditorContextMenu — precedence guards", () => {
  it("bails when a more specific menu already claimed the event", () => {
    const view = createView(createState());
    const event = contextMenuEvent();
    event.preventDefault();
    expect(handleEditorContextMenu(view as never, event)).toBe(false);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(false);
  });

  it("bails on image targets (image menu owns them)", () => {
    const view = createView(createState());
    const img = document.createElement("img");
    document.body.appendChild(img);
    const event = contextMenuEvent();
    Object.defineProperty(event, "target", { value: img });
    expect(handleEditorContextMenu(view as never, event)).toBe(false);
    img.remove();
  });

  it("bails inside tables (table menu owns them)", () => {
    const state = createState(true);
    // Position inside the table cell paragraph
    let cellPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cellPos = pos + 2;
    });
    const view = createView(state, cellPos);
    expect(isPosInTable(view as never, cellPos)).toBe(true);
    expect(handleEditorContextMenu(view as never, contextMenuEvent())).toBe(false);
  });

  it("bails when the click position cannot be resolved", () => {
    const view = createView(createState(), null);
    expect(handleEditorContextMenu(view as never, contextMenuEvent())).toBe(false);
  });
});

describe("handleEditorContextMenu — selection rule and opening", () => {
  it("moves the caret to the click position when outside the selection", () => {
    const view = createView(createState(), 8);
    const event = contextMenuEvent();
    expect(handleEditorContextMenu(view as never, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.from).toBe(8);
    expect(usePopupStore.getState().editorContextMenu.isOpen).toBe(true);
    expect(usePopupStore.getState().editorContextMenu.position).toEqual({ x: 100, y: 200 });
  });

  it("preserves a selection when the click lands inside it", () => {
    let state = createState();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 10)));
    const view = createView(state, 5);
    expect(handleEditorContextMenu(view as never, contextMenuEvent())).toBe(true);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.state.selection.from).toBe(2);
    expect(view.state.selection.to).toBe(10);
  });

  it("opens the menu with the built snapshot", () => {
    const view = createView(createState(), 3);
    handleEditorContextMenu(view as never, contextMenuEvent());
    expect(mocks.buildWysiwygSnapshot).toHaveBeenCalled();
    expect(usePopupStore.getState().editorContextMenu.snapshot).toEqual({ surface: "wysiwyg" });
  });
});
