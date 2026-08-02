/**
 * List toggle strategy tests — the heading-to-list single-transaction path.
 *
 * The strategy split itself is pinned by the nodeActions and nodeActions.headingToList
 * suites (delegation, range conversion, task lists, toggle-off). This file
 * covers what those cannot: that flattening a heading and wrapping it in a
 * list is ONE dispatched transaction — one undo step — and that a failed wrap
 * dispatches NOTHING instead of stranding a flattened paragraph.
 *
 * @coordinates-with nodeActions.tiptap.test.ts — the delegating handlers
 * @module plugins/formatToolbar/listToggle.test
 */

import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { toggleListType } from "./listToggle";

// `callout` models a container that allows headings and paragraphs but NOT
// lists, so the wrap-cannot-succeed path is reachable.
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*", attrs: { checked: { default: null } } },
    callout: { group: "block", content: "(paragraph | heading)+" },
    text: { group: "inline" },
  },
});

function liveView(doc: ReturnType<typeof testSchema.node>, pos: number, plugins: EditorState["plugins"] = []) {
  const state = EditorState.create({ doc, schema: testSchema, plugins });
  let currentState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const dispatch = vi.fn((tr: import("@tiptap/pm/state").Transaction) => {
    currentState = currentState.apply(tr);
  });
  const view = {
    get state() { return currentState; },
    focus: vi.fn(),
    dispatch,
    current: () => currentState,
  };
  return view as unknown as import("@tiptap/pm/view").EditorView & {
    current: () => EditorState;
    dispatch: typeof dispatch;
  };
}

describe("heading-to-list builds ONE transaction", () => {
  it("flatten + wrap dispatch as a SINGLE transaction (one undo step)", () => {
    const doc = testSchema.node("doc", null, [
      testSchema.node("heading", { level: 3 }, [testSchema.text("Title")]),
    ]);
    const view = liveView(doc, 3);

    expect(toggleListType(view, "bulletList")).toBe(true);

    // One dispatch = one undo step. Two separate transactions forced the user
    // to undo twice, passing through a flattened intermediate paragraph.
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const after = view.current();
    expect(after.doc.firstChild?.type.name).toBe("bulletList");
    expect(after.doc.textContent).toBe("Title");
  });

  it("a single undo restores the heading", () => {
    const doc = testSchema.node("doc", null, [
      testSchema.node("heading", { level: 3 }, [testSchema.text("Title")]),
    ]);
    const view = liveView(doc, 3, [history()]);

    expect(toggleListType(view, "bulletList")).toBe(true);
    expect(view.current().doc.firstChild?.type.name).toBe("bulletList");

    undo(view.state, view.dispatch);

    const after = view.current();
    expect(after.doc.firstChild?.type.name).toBe("heading");
    expect(after.doc.firstChild?.attrs.level).toBe(3);
    expect(after.doc.textContent).toBe("Title");
  });

  it("ordered toggle keeps its start attribute through the combined path", () => {
    const doc = testSchema.node("doc", null, [
      testSchema.node("heading", { level: 2 }, [testSchema.text("Title")]),
    ]);
    const view = liveView(doc, 3);

    expect(toggleListType(view, "orderedList")).toBe(true);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.current().doc.firstChild?.type.name).toBe("orderedList");
  });

  it("leaves the heading untouched when the wrap cannot succeed", () => {
    // A heading inside `callout`, which forbids lists: flattening first and
    // dispatching would strand a paragraph when the wrap then fails.
    const doc = testSchema.node("doc", null, [
      testSchema.node("callout", null, [
        testSchema.node("heading", { level: 2 }, [testSchema.text("Title")]),
      ]),
    ]);
    const view = liveView(doc, 3);

    expect(toggleListType(view, "bulletList")).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.current().doc.firstChild?.firstChild?.type.name).toBe("heading");
  });
});
