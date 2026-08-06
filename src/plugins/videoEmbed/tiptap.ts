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
import { VideoEmbedNodeView } from "./VideoEmbedNodeView";
import {
  parseVideoUrl,
  buildEmbedUrl,
  detectProviderFromIframeSrc,
  extractVideoInfoFromSrc,
  getProviderConfig,
  type VideoProvider,
} from "@/utils/videoProviderRegistry";
import { sourceLineAttr } from "../shared/sourceLineAttr";
import { mediaBlockKeyboardShortcuts } from "../shared/mediaNodeViewHelpers";

/** Positive-integer dimension from an attribute, else the provider default. */
function parseDim(raw: string | null | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Derive validated embed attrs from an iframe (+ optionally declared
 * data-provider). The src is AUTHORITATIVE when it parses: stale or hostile
 * data-* metadata cannot override a valid src into a mismatched embed. The
 * declared attrs only fill gaps when the src is missing or unrecognized, and
 * the final ID must pass the provider's format check — a garbage ID becomes
 * a refused parse (content preserved), not a broken about:blank embed.
 */
function embedAttrsFromIframe(
  iframe: HTMLIFrameElement | null,
  declaredProvider: string | null
): Record<string, unknown> | null {
  const src = iframe?.getAttribute("src") ?? "";
  const detected = detectProviderFromIframeSrc(src);
  const provider = (detected ?? declaredProvider ?? "youtube") as VideoProvider;
  const srcInfo = detected ? extractVideoInfoFromSrc(detected, src) : null;
  const videoId = srcInfo?.videoId || iframe?.getAttribute("data-video-id") || "";
  const config = getProviderConfig(provider);
  if (!videoId || !config?.isValidId(videoId)) return null;
  return {
    provider,
    videoId,
    privacyHash: srcInfo?.privacyHash ?? null,
    width: parseDim(iframe?.getAttribute("width"), config.defaultWidth),
    height: parseDim(iframe?.getAttribute("height"), config.defaultHeight),
  };
}

/** Tiptap node extension for embedded video players (YouTube, Vimeo, Bilibili). */
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
      // Vimeo unlisted-video privacy hash (WI-6) — required for those embeds
      // to play; recovered from the iframe src's `h=` param on parse.
      privacyHash: { default: null },
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
          // No derivable, valid video (figure without iframe, unrecognized
          // src, garbage ID) must not become an empty embed that swallows
          // the figure's content — refuse the match instead.
          const attrs = embedAttrsFromIframe(
            el.querySelector("iframe"),
            el.getAttribute("data-provider")
          );
          return attrs ?? false;
        },
      },
      {
        // Handle pasted/parsed iframes from any supported provider
        tag: "iframe",
        getAttrs: (dom) => {
          const el = dom as HTMLIFrameElement;
          // Bare iframes carry no declared metadata: only a recognized src
          // may produce an embed.
          if (!detectProviderFromIframeSrc(el.getAttribute("src") ?? "")) return false;
          const attrs = embedAttrsFromIframe(el, null);
          return attrs ?? false;
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
          src: buildEmbedUrl(provider, videoId, { privacyHash: node.attrs.privacyHash as string | null }),
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
      /* v8 ignore start -- @preserve reason: getPos is always a function in Tiptap NodeView context */
      const safeGetPos = typeof getPos === "function" ? getPos : () => undefined;
      /* v8 ignore stop */
      return new VideoEmbedNodeView(node, safeGetPos, editor);
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

            // Insert video_embed node with detected provider and provider-specific defaults
            const config = getProviderConfig(result.provider);
            const node = nodeType.create({
              provider: result.provider,
              videoId: result.videoId,
              privacyHash: result.privacyHash ?? null,
              width: config?.defaultWidth ?? 560,
              height: config?.defaultHeight ?? 315,
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
