/**
 * Block Image Tiptap Node
 *
 * Purpose: Defines the block_image node type — standalone images rendered as `<figure>`
 * elements with a custom NodeView for interactive features (resize, context menu, tooltip).
 *
 * Key decisions:
 *   - `ownerTabId` names the document these nodes belong to, so a relative
 *     `src` resolves against ITS directory rather than the focused tab's.
 *     Full reasoning on the option itself and in
 *     `services/assembly/blockMediaExtensions.ts`.
 *   - `atom: true` makes the image a single selectable unit (no cursor inside)
 *   - Arrow key handlers allow navigation into/out of block images from adjacent blocks
 *   - Enter on a selected block image creates a paragraph below for continued typing
 *
 * @coordinates-with BlockImageNodeView.ts — custom NodeView with image loading, resize, and menus
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @module plugins/blockImage/tiptap
 */

import "./block-image.css";
import { Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { BlockImageNodeView } from "./BlockImageNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { referenceIdentityAttrs } from "@/utils/referenceIdentity";

/** Tiptap node extension for block-level images with custom NodeView. */
export interface BlockImageExtensionOptions {
  /**
   * The tab whose document owns these nodes, so a relative `src` resolves
   * against ITS directory rather than against whichever tab currently has
   * focus. Configured per editor by `services/assembly/tiptapExtensions.ts`.
   *
   * `undefined` keeps the previous focused-tab behaviour, which is the right
   * answer when nothing owns the editor (a preview with no tab behind it). It
   * is the WRONG answer for a split view: the unfocused pane resolved against
   * the other document, and changed its answer as focus moved.
   */
  ownerTabId: string | undefined;
}

export const blockImageExtension = Node.create<BlockImageExtensionOptions>({
  name: "block_image",

  addOptions() {
    return { ownerTabId: undefined };
  },

  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  defining: true,

  addAttributes() {
    return {
      ...referenceIdentityAttrs,
      ...sourceLineAttr,
      src: { default: "" },
      alt: { default: "" },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="block_image"]',
        getAttrs: (dom) => {
          const img = (dom as HTMLElement).querySelector("img");
          return {
            src: img?.getAttribute("src") ?? "",
            alt: img?.getAttribute("alt") ?? "",
            title: img?.getAttribute("title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "figure",
      {
        ...HTMLAttributes,
        "data-type": "block_image",
        class: "block-image",
      },
      [
        "img",
        {
          src: String(node.attrs.src ?? ""),
          alt: String(node.attrs.alt ?? ""),
          title: String(node.attrs.title ?? ""),
        },
      ],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new BlockImageNodeView(node, safeGetPos, editor, this.options.ownerTabId);
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        // Only handle when this block_image is selected via NodeSelection
        if (!(state.selection instanceof NodeSelection)) return false;
        if (state.selection.node.type.name !== "block_image") return false;

        // Insert a paragraph after the image and move cursor there
        const pos = state.selection.to;
        editor
          .chain()
          .insertContentAt(pos, { type: "paragraph" })
          .setTextSelection(pos + 1)
          .run();
        return true;
      },

      ArrowUp: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        // Check if we're at the start of a block and the previous node is block_image
        if ($from.parentOffset === 0) {
          const before = $from.before();
          if (before > 0) {
            const nodeBefore = state.doc.resolve(before).nodeBefore;
            if (nodeBefore?.type.name === "block_image") {
              const imagePos = before - nodeBefore.nodeSize;
              editor.commands.setNodeSelection(imagePos);
              return true;
            }
          }
        }
        return false;
      },

      ArrowDown: ({ editor }) => {
        const { state } = editor;
        const { $to } = state.selection;

        // Check if we're at the end of a block and the next node is block_image
        if ($to.parentOffset === $to.parent.content.size) {
          const after = $to.after();
          if (after < state.doc.content.size) {
            const nodeAfter = state.doc.resolve(after).nodeAfter;
            if (nodeAfter?.type.name === "block_image") {
              editor.commands.setNodeSelection(after);
              return true;
            }
          }
        }
        return false;
      },
    };
  },
});
