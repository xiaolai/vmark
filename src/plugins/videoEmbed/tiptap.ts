/**
 * Video Embed Tiptap Node
 *
 * Purpose: Defines the video_embed node type — renders video embeds from
 * YouTube, Vimeo, and Bilibili as iframes inside a responsive wrapper.
 *
 * Key decisions:
 *   - Provider-agnostic node with `provider` attribute
 *   - Uses the video provider registry for URL parsing and embed generation
 *   - `atom: true` makes the embed a single selectable unit
 *   - YouTube uses youtube-nocookie.com for privacy-enhanced mode
 *
 * @coordinates-with VideoEmbedNodeView.ts — custom NodeView for iframe rendering
 * @coordinates-with utils/videoProviderRegistry.ts — URL parsing and embed URL generation
 * @module plugins/videoEmbed/tiptap
 */

import "./video-embed.css";
import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { VideoEmbedNodeView } from "./VideoEmbedNodeView";
import {
  parseVideoUrl,
  buildEmbedUrl,
  detectProviderFromIframeSrc,
  extractVideoIdFromSrc,
  type VideoProvider,
} from "@/utils/videoProviderRegistry";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";

export const videoEmbedExtension = Node.create({
  name: "video_embed",
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
      provider: { default: "youtube" },
      videoId: { default: "" },
      width: { default: 560 },
      height: { default: 315 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="video_embed"]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const iframe = el.querySelector("iframe");
          const videoId = iframe?.getAttribute("data-video-id") ?? "";
          const provider = el.getAttribute("data-provider") ?? "youtube";
          const w = parseInt(iframe?.getAttribute("width") ?? "560", 10);
          const h = parseInt(iframe?.getAttribute("height") ?? "315", 10);
          return {
            provider,
            videoId,
            width: Number.isFinite(w) && w > 0 ? w : 560,
            height: Number.isFinite(h) && h > 0 ? h : 315,
          };
        },
      },
      {
        // Handle pasted/parsed iframes from any supported provider
        tag: "iframe",
        getAttrs: (dom) => {
          const el = dom as HTMLIFrameElement;
          const src = el.getAttribute("src") ?? "";
          const provider = detectProviderFromIframeSrc(src);
          if (!provider) return false; // Not a recognized provider — skip
          const videoId = extractVideoIdFromSrc(provider, src);
          if (!videoId) return false;
          const w = parseInt(el.getAttribute("width") ?? "560", 10);
          const h = parseInt(el.getAttribute("height") ?? "315", 10);
          return {
            provider,
            videoId,
            width: Number.isFinite(w) && w > 0 ? w : 560,
            height: Number.isFinite(h) && h > 0 ? h : 315,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const provider = String(node.attrs.provider ?? "youtube") as VideoProvider;
    const videoId = String(node.attrs.videoId ?? "");
    return [
      "figure",
      {
        ...HTMLAttributes,
        "data-type": "video_embed",
        "data-provider": provider,
        class: "video-embed",
      },
      [
        "iframe",
        {
          src: buildEmbedUrl(provider, videoId),
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
      return new VideoEmbedNodeView(node, safeGetPos, editor) as unknown as NodeView;
    };
  },

  addKeyboardShortcuts() {
    return mediaBlockKeyboardShortcuts("video_embed");
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("videoEmbedPasteHandler"),
        props: {
          handlePaste(view, event) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            // Only handle plain-text paste (no HTML — HTML iframes are handled by parseHTML)
            const html = clipboardData.getData("text/html");
            if (html) return false;

            const text = clipboardData.getData("text/plain")?.trim();
            if (!text) return false;

            // Check if the pasted text is a video URL from any supported provider
            const result = parseVideoUrl(text);
            if (!result) return false;

            // Insert video_embed node with detected provider
            const node = nodeType.create({
              provider: result.provider,
              videoId: result.videoId,
            });
            const tr = view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
