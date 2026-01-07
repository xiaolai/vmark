import { describe, expect, it } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { taskListItemExtension } from "./tiptap";

function createSchema() {
  return getSchema([StarterKit.configure({ listItem: false }), taskListItemExtension]);
}

describe("taskListItemExtension renderHTML", () => {
  it("serializes task list DOM without content hole errors", () => {
    const schema = createSchema();
    const paragraph = schema.nodes.paragraph.create(null, schema.text("Task"));
    const listItem = schema.nodes.listItem.create({ checked: true }, paragraph);
    const bulletList = schema.nodes.bulletList.create(null, [listItem]);
    const doc = schema.nodes.doc.create(null, [bulletList]);

    const serializer = DOMSerializer.fromSchema(schema);
    expect(() => serializer.serializeFragment(doc.content)).not.toThrow();
  });
});
