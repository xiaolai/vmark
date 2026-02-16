/**
 * YouTube Embed Tiptap Node
 *
 * Purpose: Defines the youtube_embed node type — renders YouTube videos as
 * privacy-enhanced iframes (youtube-nocookie.com) inside a responsive wrapper.
 *
 * Key decisions:
 *   - Uses youtube-nocookie.com for privacy-enhanced mode
 *   - 16:9 aspect ratio wrapper for responsive sizing
 *   - `atom: true` makes the embed a single selectable unit
 *   - Default dimensions: 560x315 (standard YouTube embed)
 *
 * @coordinates-with YoutubeEmbedNodeView.ts — custom NodeView for iframe rendering
 * @coordinates-with urlParser.ts — extracts video ID from various YouTube URL formats
 * @module plugins/youtubeEmbed/tiptap
 */

import "./youtube-embed.css";
import { Node } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { YoutubeEmbedNodeView } from "./YoutubeEmbedNodeView";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";

export const youtubeEmbedExtension = Node.create({
  name: "youtube_embed",
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
      videoId: { default: "" },
      width: { default: 560 },
      height: { default: 315 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="youtube_embed"]',
        getAttrs: (dom) => {
          const iframe = (dom as HTMLElement).querySelector("iframe");
          const videoId = iframe?.getAttribute("data-video-id") ?? "";
          const w = parseInt(iframe?.getAttribute("width") ?? "560", 10);
          const h = parseInt(iframe?.getAttribute("height") ?? "315", 10);
          return {
            videoId,
            width: Number.isFinite(w) && w > 0 ? w : 560,
            height: Number.isFinite(h) && h > 0 ? h : 315,
          };
        },
      },
      {
        // Handle pasted/parsed YouTube iframes (e.g., from embed code or markdown HTML)
        tag: "iframe",
        getAttrs: (dom) => {
          const el = dom as HTMLIFrameElement;
          const src = el.getAttribute("src") ?? "";
          const match = src.match(/youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/);
          if (!match) return false; // Not a YouTube iframe — skip
          const w = parseInt(el.getAttribute("width") ?? "560", 10);
          const h = parseInt(el.getAttribute("height") ?? "315", 10);
          return {
            videoId: match[1],
            width: Number.isFinite(w) && w > 0 ? w : 560,
            height: Number.isFinite(h) && h > 0 ? h : 315,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const videoId = String(node.attrs.videoId ?? "");
    return [
      "figure",
      {
        ...HTMLAttributes,
        "data-type": "youtube_embed",
        class: "youtube-embed",
      },
      [
        "iframe",
        {
          src: `https://www.youtube-nocookie.com/embed/${videoId}`,
          width: String(node.attrs.width ?? 560),
          height: String(node.attrs.height ?? 315),
          frameborder: "0",
          allowfullscreen: "true",
          "data-video-id": videoId,
        },
      ],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      return new YoutubeEmbedNodeView(node, safeGetPos, editor) as unknown as NodeView;
    };
  },

  addKeyboardShortcuts() {
    return mediaBlockKeyboardShortcuts("youtube_embed");
  },
});
