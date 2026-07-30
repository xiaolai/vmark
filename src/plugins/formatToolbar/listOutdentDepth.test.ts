/**
 * Outdent depth semantics.
 *
 * "Outdent" removes one level of NESTING. At the outermost level there is none
 * to remove, so the command declines rather than lifting the item out of its
 * list — VMark already has Remove List and the list toggles for leaving a list,
 * and using outdent as a third, implicit unlist blurs the action model. Source
 * mode always declined here; `liftListItem` was the only reason the two surfaces
 * disagreed.
 *
 * Separate file because nodeActions.tiptap.test.ts sits at its frozen cap.
 *
 * @coordinates-with nodeActions.tiptap.ts — handleListOutdent
 * @module plugins/formatToolbar/listOutdentDepth.test
 */
import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { handleListOutdent } from "./nodeActions.tiptap";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
  },
});

const p = (text: string) => schema.node("paragraph", null, [schema.text(text)]);
const item = (...content: ReturnType<typeof p>[]) => schema.node("listItem", null, content);

/** A view whose dispatch really applies, so lift can read the updated state. */
function viewAt(doc: ReturnType<typeof schema.node>, needle: string) {
  let pos = -1;
  doc.descendants((node, at) => {
    if (node.isText && node.text === needle) pos = at;
    return true;
  });
  let state = EditorState.create({ doc, schema });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  const dispatch = vi.fn((tr: import("@tiptap/pm/state").Transaction) => {
    state = state.apply(tr);
  });
  return {
    view: {
      get state() {
        return state;
      },
      focus: vi.fn(),
      dispatch,
    } as unknown as EditorView,
    dispatch,
    depthOf: () => state.doc.resolve(1).depth,
  };
}

describe("handleListOutdent — nesting depth", () => {
  it("declines on a top-level item and changes nothing", () => {
    const doc = schema.node("doc", null, [schema.node("bulletList", null, [item(p("Only"))])]);
    const { view, dispatch } = viewAt(doc, "Only");
    expect(handleListOutdent(view)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("declines on a top-level item even when the list has several", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [item(p("one")), item(p("two")), item(p("three"))]),
    ]);
    const { view, dispatch } = viewAt(doc, "two");
    expect(handleListOutdent(view)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lifts a NESTED item one level", () => {
    const inner = schema.node("bulletList", null, [item(p("Inner"))]);
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [item(p("Outer"), inner)]),
    ]);
    const { view, dispatch } = viewAt(doc, "Inner");
    expect(handleListOutdent(view)).toBe(true);
    expect(dispatch).toHaveBeenCalled();
  });

  it("declines when the cursor is not in a list at all", () => {
    const doc = schema.node("doc", null, [p("plain paragraph")]);
    const { view, dispatch } = viewAt(doc, "plain paragraph");
    expect(handleListOutdent(view)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
