/**
 * Block Video Tiptap Node
 *
 * Purpose: Defines the block_video node type — standalone videos rendered as `<figure>`
 * elements with a custom NodeView for interactive features (playback, context menu).
 *
 * Key decisions:
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
import type { NodeView } from "@tiptap/pm/view";
import { BlockVideoNodeView } from "./BlockVideoNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";

export const blockVideoExtension = Node.create({
  name: "block_video",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  marks: "",
  defining: true,

  addAttributes() {
    return {
      ...sourceLineAttr,
      src: { default: "" },
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
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new BlockVideoNodeView(node, safeGetPos, editor) as unknown as NodeView;
    };
  },

  addKeyboardShortcuts() {
    return mediaBlockKeyboardShortcuts("block_video");
  },
});
