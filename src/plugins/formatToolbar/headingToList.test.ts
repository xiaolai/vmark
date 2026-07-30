import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    bulletList: { group: "block", content: "listItem+" },
    orderedList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*", attrs: { checked: { default: null } } },
    text: { group: "inline" },
  },
});

/**
 * A line cannot be a heading AND a list item, so converting one to the other has
 * to drop the heading. Source mode already did (`### Title` -> `- Title`);
 * WYSIWYG's `wrapInList` simply refused on a heading and the button did nothing.
 */
describe("list conversion from a heading", () => {
  function headingView(text: string) {
    const state = EditorState.create({
      doc: testSchema.node("doc", null, [
        testSchema.node("heading", { level: 3 }, [testSchema.text(text)]),
      ]),
    });
    let current = state;
    const view = {
      get state() {
        return current;
      },
      focus: vi.fn(),
      dispatch: (tr: import("@tiptap/pm/state").Transaction) => {
        current = current.apply(tr);
      },
    } as unknown as import("@tiptap/pm/view").EditorView;
    return { view, doc: () => current.doc };
  }

  it.each([
    { fn: "handleToBulletList", list: "bulletList" },
    { fn: "handleToOrderedList", list: "orderedList" },
  ])("$fn converts a heading into a $list", async ({ fn, list }) => {
    const mod = await import("./nodeActions.tiptap");
    const { view, doc } = headingView("Title");
    const applied = (mod as unknown as Record<string, (v: unknown) => boolean>)[fn](view);

    expect(applied).toBe(true);
    expect(doc().firstChild?.type.name).toBe(list);
    expect(doc().textContent).toBe("Title");
    // The heading must be GONE, not nested inside the item.
    let hasHeading = false;
    doc().descendants((n) => {
      if (n.type.name === "heading") hasHeading = true;
    });
    expect(hasHeading).toBe(false);
  });
});
