import { Mark, mergeAttributes } from "@tiptap/core";

export const highlightExtension = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "md-highlight" }), 0];
  },
});

