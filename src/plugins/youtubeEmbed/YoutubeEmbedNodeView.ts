/**
 * YouTube Embed NodeView
 *
 * Purpose: Custom ProseMirror NodeView for youtube_embed nodes — renders a responsive
 * 16:9 iframe wrapper with privacy-enhanced YouTube embed.
 *
 * Key decisions:
 *   - Uses youtube-nocookie.com for privacy
 *   - Responsive 16:9 wrapper via padding-bottom trick
 *   - Click on overlay selects the node (iframe eats clicks otherwise)
 *
 * @coordinates-with tiptap.ts — registers this NodeView for the youtube_embed node type
 * @coordinates-with urlParser.ts — video ID validation
 * @module plugins/youtubeEmbed/YoutubeEmbedNodeView
 */

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import { YOUTUBE_VIDEO_ID_RE } from "@/utils/youtubeUrlParser";

export class YoutubeEmbedNodeView implements NodeView {
  dom: HTMLElement;
  private wrapper: HTMLElement;
  private iframe: HTMLIFrameElement;
  private overlay: HTMLElement;
  private getPos: () => number | undefined;
  private editor: Editor;

  constructor(node: PMNode, getPos: () => number | undefined, editor: Editor) {
    this.getPos = getPos;
    this.editor = editor;

    const rawId = String(node.attrs.videoId ?? "");
    const videoId = YOUTUBE_VIDEO_ID_RE.test(rawId) ? rawId : "";

    this.dom = document.createElement("figure");
    this.dom.className = "youtube-embed";
    this.dom.setAttribute("data-type", "youtube_embed");

    this.wrapper = document.createElement("div");
    this.wrapper.className = "youtube-embed-wrapper";

    this.iframe = document.createElement("iframe");
    this.iframe.src = videoId
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : "about:blank";
    this.iframe.width = String(node.attrs.width ?? 560);
    this.iframe.height = String(node.attrs.height ?? 315);
    this.iframe.setAttribute("frameborder", "0");
    this.iframe.setAttribute("allowfullscreen", "true");
    this.iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");

    // Overlay to capture clicks (iframes eat click events)
    this.overlay = document.createElement("div");
    this.overlay.className = "youtube-embed-overlay";
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
    if (node.type.name !== "youtube_embed") return false;

    const rawId = String(node.attrs.videoId ?? "");
    const videoId = YOUTUBE_VIDEO_ID_RE.test(rawId) ? rawId : "";
    const newSrc = videoId
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : "about:blank";
    if (this.iframe.src !== newSrc) {
      this.iframe.src = newSrc;
    }
    this.iframe.width = String(node.attrs.width ?? 560);
    this.iframe.height = String(node.attrs.height ?? 315);

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
