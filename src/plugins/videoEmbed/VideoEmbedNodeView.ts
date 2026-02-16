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

    const provider = (node.attrs.provider ?? "youtube") as VideoProvider;
    const videoId = String(node.attrs.videoId ?? "");
    const config = getProviderConfig(provider);

    this.dom = document.createElement("figure");
    this.dom.className = "video-embed";
    this.dom.setAttribute("data-type", "video_embed");
    this.dom.setAttribute("data-provider", provider);

    this.wrapper = document.createElement("div");
    this.wrapper.className = "video-embed-wrapper";
    if (config) {
      this.wrapper.style.paddingBottom = config.aspectRatio;
    }

    this.iframe = document.createElement("iframe");
    this.iframe.src = videoId ? buildEmbedUrl(provider, videoId) : "about:blank";
    this.iframe.width = String(node.attrs.width ?? config?.defaultWidth ?? 560);
    this.iframe.height = String(node.attrs.height ?? config?.defaultHeight ?? 315);
    this.iframe.setAttribute("frameborder", "0");
    this.iframe.setAttribute("allowfullscreen", "true");
    this.iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");

    // Overlay to capture clicks (iframes eat click events)
    this.overlay = document.createElement("div");
    this.overlay.className = "video-embed-overlay";
    this.overlay.addEventListener("click", this.handleClick);

    this.wrapper.appendChild(this.iframe);
    this.wrapper.appendChild(this.overlay);
    this.dom.appendChild(this.wrapper);
  }

  private handleClick = (_e: MouseEvent) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    try {
      const { view } = this.editor;
      const selection = NodeSelection.create(view.state.doc, pos);
      const tr = view.state.tr.setSelection(selection);
      view.dispatch(tr.setMeta("addToHistory", false));
    } catch {
      // Ignore selection errors
    }
  };

  update(node: PMNode): boolean {
    if (node.type.name !== "video_embed") return false;

    const provider = (node.attrs.provider ?? "youtube") as VideoProvider;
    const videoId = String(node.attrs.videoId ?? "");
    const config = getProviderConfig(provider);
    const newSrc = videoId ? buildEmbedUrl(provider, videoId) : "about:blank";

    if (this.iframe.src !== newSrc) {
      this.iframe.src = newSrc;
    }
    this.iframe.width = String(node.attrs.width ?? config?.defaultWidth ?? 560);
    this.iframe.height = String(node.attrs.height ?? config?.defaultHeight ?? 315);

    if (config) {
      this.wrapper.style.paddingBottom = config.aspectRatio;
    }
    this.dom.setAttribute("data-provider", provider);

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
