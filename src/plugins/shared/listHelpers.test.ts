// @vitest-environment node
/**
 * Tests for shared list helpers.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { findListItemType, isPositionInsideListItem } from "./listHelpers";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { inline: true, group: "inline" },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*", defining: true },
  },
});

const underscoreSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { inline: true, group: "inline" },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*", defining: true },
  },
});

const noListSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

describe("findListItemType", () => {
  it("returns listItem from Tiptap-style schema", () => {
    expect(findListItemType(schema)?.name).toBe("listItem");
  });

  it("returns list_item from underscore-style schema", () => {
    expect(findListItemType(underscoreSchema)?.name).toBe("list_item");
  });

  it("returns undefined when no list item node exists", () => {
    expect(findListItemType(noListSchema)).toBeUndefined();
  });
});

describe("isPositionInsideListItem", () => {
  it("returns true for position inside a list item", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("inside")]),
        ]),
      ]),
    ]);
    const state = EditorState.create({ doc, schema });
    const $pos = state.doc.resolve(3); // inside "inside" text
    expect(isPositionInsideListItem($pos, findListItemType(schema)!)).toBe(true);
  });

  it("returns false for position outside a list item", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("inside")]),
        ]),
      ]),
      schema.node("paragraph", null, [schema.text("outside")]),
    ]);
    const state = EditorState.create({ doc, schema });
    // Find "outside" text position
    let outsidePos = 0;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "outside") {
        outsidePos = pos;
        return false;
      }
    });
    expect(isPositionInsideListItem(state.doc.resolve(outsidePos), findListItemType(schema)!)).toBe(false);
  });

  it("returns true for position inside an empty list item", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, []),
        ]),
      ]),
    ]);
    const state = EditorState.create({ doc, schema });
    // Position inside the empty paragraph: doc(0) > bulletList(1) > listItem(2) > paragraph(3) → pos 3
    expect(isPositionInsideListItem(state.doc.resolve(3), findListItemType(schema)!)).toBe(true);
  });
});
