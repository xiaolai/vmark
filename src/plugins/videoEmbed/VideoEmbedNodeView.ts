/**
 * Video Embed NodeView
 *
 * Purpose: Custom ProseMirror NodeView for video_embed nodes — renders a responsive
 * iframe wrapper with privacy-enhanced embeds for YouTube, Vimeo, and Bilibili.
 *
 * Key decisions:
 *   - Uses the video provider registry for embed URL generation
 *   - Responsive wrapper via padding-bottom trick (aspect ratio per provider)
 *   - Click on overlay selects the node (iframe eats clicks otherwise)
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the video_embed node type
 * @coordinates-with utils/videoProviderRegistry.ts — embed URL generation
 * @module plugins/videoEmbed/VideoEmbedNodeView
 */

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { buildEmbedUrl, getProviderConfig, type VideoProvider } from "@/utils/videoProviderRegistry";
import { videoEmbedError } from "@/utils/debug";

/** Everything the DOM needs, derived ONCE from node attrs (constructor and
 *  update share this — they used to drift independently). */
interface EmbedRenderState {
  provider: VideoProvider;
  src: string;
  width: string;
  height: string;
  /** Empty string clears a stale ratio when the provider config is missing. */
  aspectRatio: string;
}

/** Finite positive integer, else the provider default. */
function embedDim(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function deriveRenderState(node: PMNode): EmbedRenderState {
  const provider = (node.attrs.provider ?? "youtube") as VideoProvider;
  const videoId = String(node.attrs.videoId ?? "");
  const config = getProviderConfig(provider);
  return {
    provider,
    src: videoId
      ? buildEmbedUrl(provider, videoId, { privacyHash: node.attrs.privacyHash as string | null })
      : "about:blank",
    width: String(embedDim(node.attrs.width, config?.defaultWidth ?? 560)),
    height: String(embedDim(node.attrs.height, config?.defaultHeight ?? 315)),
    aspectRatio: config?.aspectRatio ?? "",
  };
}

export class VideoEmbedNodeView implements NodeView {
  dom: HTMLElement;
  private wrapper: HTMLElement;
  private iframe: HTMLIFrameElement;
  private overlay: HTMLElement;
  private getPos: () => number | undefined;
  private editor: Editor;

  constructor(node: PMNode, getPos: () => number | undefined, editor: Editor) {
    this.getPos = getPos;
    this.editor = editor;

    this.dom = document.createElement("figure");
    this.dom.className = "video-embed";
    this.dom.setAttribute("data-type", "video_embed");

    this.wrapper = document.createElement("div");
    this.wrapper.className = "video-embed-wrapper";

    this.iframe = document.createElement("iframe");
    this.iframe.setAttribute("frameborder", "0");
    this.iframe.setAttribute("allowfullscreen", "true");
    this.iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    this.applyRenderState(deriveRenderState(node));

    // Overlay to capture clicks (iframes eat click events)
    this.overlay = document.createElement("div");
    this.overlay.className = "video-embed-overlay";
    this.overlay.addEventListener("click", this.handleClick);

    this.wrapper.appendChild(this.iframe);
    this.wrapper.appendChild(this.overlay);
    this.dom.appendChild(this.wrapper);
  }

  /** Write one render state to the DOM — the single mutation path. */
  private applyRenderState(state: EmbedRenderState): void {
    this.dom.setAttribute("data-provider", state.provider);
    // Assign unconditionally: an unknown provider must CLEAR a stale ratio.
    this.wrapper.style.paddingBottom = state.aspectRatio;
    if (this.iframe.src !== state.src) this.iframe.src = state.src;
    this.iframe.width = state.width;
    this.iframe.height = state.height;
  }

  private handleClick = (_e: MouseEvent) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    try {
      const { view } = this.editor;
      const selection = NodeSelection.create(view.state.doc, pos);
      const tr = view.state.tr.setSelection(selection);
      view.dispatch(tr.setMeta("addToHistory", false));
    } catch (error) {
      // A stale position between doc updates is expected; anything else is a
      // real defect and must not vanish silently.
      videoEmbedError("node selection failed:", error);
    }
  };

  update(node: PMNode): boolean {
    if (node.type.name !== "video_embed") return false;
    this.applyRenderState(deriveRenderState(node));
    return true;
  }

  destroy(): void {
    this.overlay.removeEventListener("click", this.handleClick);
  }

  stopEvent(event: Event): boolean {
    if (event.type === "mousedown" || event.type === "click") {
      return true;
    }
    return false;
  }

  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
    // Hide overlay so user can interact with iframe
    this.overlay.style.display = "none";
    window.getSelection()?.removeAllRanges();
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
    // Show overlay again to capture clicks
    this.overlay.style.display = "";
  }
}
