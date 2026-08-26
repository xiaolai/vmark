/**
 * Block Video Tiptap Node
 *
 * Purpose: Defines the block_video node type — standalone videos rendered as `<figure>`
 * elements with a custom NodeView for interactive features (playback, context menu).
 *
 * Key decisions:
 *   - `ownerTabId` names the document these nodes belong to, so a relative
 *     `src` resolves against ITS directory rather than the focused tab's.
 *     Full reasoning on the option itself and in
 *     `services/assembly/blockMediaExtensions.ts`.
 *   - `atom: true` makes the video a single selectable unit (no cursor inside)
 *   - Arrow key handlers allow navigation into/out of block videos from adjacent blocks
 *   - Enter on a selected block video creates a paragraph below for continued typing
 *   - `controls: true` by default for immediate playability
 *   - `preload: "metadata"` by default for fast thumbnail display without full download
 *
 * @coordinates-with BlockVideoNodeView.ts — custom NodeView with video loading and menus
 * @coordinates-with shared/sourceLineAttr.ts — source line tracking for cursor sync
 * @module plugins/blockVideo/tiptap
 */

import "./block-video.css";
import { Node } from "@tiptap/core";
import { BlockVideoNodeView } from "./BlockVideoNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";
import { referenceIdentityAttrs } from "@/utils/referenceIdentity";

/** Tiptap node extension for block-level video elements. */
export interface BlockVideoExtensionOptions {
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

export const blockVideoExtension = Node.create<BlockVideoExtensionOptions>({
  name: "block_video",

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
      poster: { default: "" },
      controls: { default: true },
      preload: { default: "metadata" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="block_video"]',
        getAttrs: (dom) => {
          const video = (dom as HTMLElement).querySelector("video");
          return {
            src: video?.getAttribute("src") ?? "",
            title: video?.getAttribute("title") ?? "",
            poster: video?.getAttribute("poster") ?? "",
            controls: video?.hasAttribute("controls") ?? true,
            preload: video?.getAttribute("preload") ?? "metadata",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const videoAttrs: Record<string, string> = {
      src: String(node.attrs.src ?? ""),
      preload: String(node.attrs.preload ?? "metadata"),
    };
    if (node.attrs.title) videoAttrs.title = String(node.attrs.title);
    if (node.attrs.poster) videoAttrs.poster = String(node.attrs.poster);
    if (node.attrs.controls) videoAttrs.controls = "controls";

    return [
      "figure",
      {
        ...HTMLAttributes,
        "data-type": "block_video",
        class: "block-video",
      },
      ["video", videoAttrs],
    ];
  },

  addNodeView() {
    /* v8 ignore start -- @preserve reason: addNodeView factory callback only runs in live Tiptap editor; not exercised in unit tests */
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new BlockVideoNodeView(node, safeGetPos, editor, this.options.ownerTabId);
    };
    /* v8 ignore stop */
  },

  addKeyboardShortcuts() {
    return mediaBlockKeyboardShortcuts("block_video");
  },
});
