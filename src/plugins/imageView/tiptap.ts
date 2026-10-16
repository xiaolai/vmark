/**
 * Image view extension — extends Tiptap's Image node with reference-identity
 * and title attributes and renders it through the custom `ImageNodeView`.
 *
 * @module plugins/imageView/tiptap
 */

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
    return ({ node, getPos, editor, view }) => {
      return new ImageNodeView(node, getPos, editor, view.dom);
    };
  },
}).configure({ inline: true });
