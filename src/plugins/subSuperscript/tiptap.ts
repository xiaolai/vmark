import { Mark, mergeAttributes } from "@tiptap/core";

export const subscriptExtension = Mark.create({
  name: "subscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes, { class: "md-subscript" }), 0];
  },
});

export const superscriptExtension = Mark.create({
  name: "superscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "md-superscript" }), 0];
  },
});

