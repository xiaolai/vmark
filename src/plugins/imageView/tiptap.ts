import Image from "@tiptap/extension-image";
import { referenceIdentityAttrs } from "@/utils/referenceIdentity";
import { ImageNodeView } from "./index";

/** Tiptap extension that overrides the default Image node with a custom NodeView. */
export const imageViewExtension = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // `![alt][id]` resolves to an inline image for editing but must
      // serialize back as the reference the author wrote.
      ...referenceIdentityAttrs,
      title: { default: null },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      return new ImageNodeView(node, getPos, editor);
    };
  },
}).configure({ inline: true });
