/**
 * Wiki Link Popup Extension
 *
 * Purpose: Shows an editing popup when the cursor enters a [[wiki link]] node in
 * WYSIWYG mode. Supports hover-to-preview (300ms delay) and click-to-edit.
 * Cmd+Click opens the target file/heading instead.
 *
 * Key decisions:
 *   - Hover detection uses mouseover + timeout to avoid flicker on fast mouse movement
 *   - The popup manages target path editing; display text is edited inline in the node
 *   - Plugin view subscribes to store for lifecycle (store-driven open/close)
 *
 * @coordinates-with WikiLinkPopupView.ts — DOM and interaction logic for the popup
 * @coordinates-with wikiLinkPopupStore.ts — open/close/target state
 * @coordinates-with markdownArtifacts/wikiLink.ts — the wiki link node definition
 * @module plugins/wikiLinkPopup/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { WikiLinkPopupView } from "./WikiLinkPopupView";

const wikiLinkPopupPluginKey = new PluginKey("wikiLinkPopup");

const HOVER_DELAY = 300;

class WikiLinkPopupPluginView {
  private popupView: WikiLinkPopupView;
  private view: EditorView;
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentLinkElement: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.popupView = new WikiLinkPopupView(view);

    view.dom.addEventListener("mouseover", this.handleMouseOver);
    view.dom.addEventListener("mouseout", this.handleMouseOut);
  }

  private handleMouseOver = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const linkElement = target.closest("span.wiki-link") as HTMLElement | null;

    if (!linkElement) {
      this.clearHoverTimeout();
      return;
    }

    if (linkElement === this.currentLinkElement) return;

    this.clearHoverTimeout();
    this.currentLinkElement = linkElement;

    this.hoverTimeout = setTimeout(() => {
      this.showPopupForLink(linkElement);
    }, HOVER_DELAY);
  };

  private handleMouseOut = (event: MouseEvent) => {
    const relatedTarget = event.relatedTarget as HTMLElement | null;

    const popup = document.querySelector(".wiki-link-popup");
    if (popup && (popup.contains(relatedTarget) || popup === relatedTarget)) {
      return;
    }

    if (relatedTarget?.closest("span.wiki-link")) return;

    this.clearHoverTimeout();
    this.currentLinkElement = null;

    this.hoverTimeout = setTimeout(() => {
      const popupEl = document.querySelector(".wiki-link-popup");
      if (popupEl && !popupEl.matches(":hover")) {
        useWikiLinkPopupStore.getState().closePopup();
      }
    }, 100);
  };

  private showPopupForLink(linkElement: HTMLElement) {
    try {
      // Get position inside the content
      const innerPos = this.view.posAtDOM(linkElement, 0);
      const $pos = this.view.state.doc.resolve(innerPos);

      // For content-based nodes, we need to find the parent wikiLink node
      // Check if we're inside a wikiLink by looking at ancestors
      let nodePos = -1;
      let node = null;

      // Check if current position's parent is the wikiLink
      if ($pos.parent.type.name === "wikiLink") {
        // $pos.before() gives us the position just before the parent node
        nodePos = $pos.before();
        node = $pos.parent;
      } else {
        // Fallback: try position - 1 (for when posAtDOM returns start of content)
        const beforePos = innerPos - 1;
        if (beforePos >= 0) {
          const maybeNode = this.view.state.doc.nodeAt(beforePos);
          if (maybeNode?.type.name === "wikiLink") {
            nodePos = beforePos;
            node = maybeNode;
          }
        }
      }

      if (!node || node.type.name !== "wikiLink" || nodePos < 0) return;

      const rect = linkElement.getBoundingClientRect();
      useWikiLinkPopupStore.getState().openPopup(
        {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        },
        String(node.attrs.value ?? ""),
        nodePos
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug("[WikiLinkPopup] Failed to show popup:", error);
      }
    }
  }

  private clearHoverTimeout() {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
  }

  update() {
    // Popup updates via store subscription
  }

  destroy() {
    this.clearHoverTimeout();
    this.view.dom.removeEventListener("mouseover", this.handleMouseOver);
    this.view.dom.removeEventListener("mouseout", this.handleMouseOut);
    this.popupView.destroy();
  }
}

export const wikiLinkPopupExtension = Extension.create({
  name: "wikiLinkPopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiLinkPopupPluginKey,
        view: (editorView) => new WikiLinkPopupPluginView(editorView),
      }),
    ];
  },
});
