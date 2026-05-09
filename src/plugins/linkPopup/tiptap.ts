/**
 * Link Popup Plugin (Tiptap)
 *
 * Handles Cmd+Click to open links — heading navigation for `#fragment`,
 * browser open for external URLs, and tab open for cross-file links
 * (relative or absolute filesystem paths) resolved against the active
 * document's directory.
 *
 * Regular click on a link opens the edit popup.
 * Cmd+K also opens the edit popup (handled in editorPlugins.tiptap.ts).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Mark } from "@tiptap/pm/model";
import { linkPopupError } from "@/utils/debug";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { navigateToHeadingById } from "@/utils/headingSlug";
import { classifyHref, openFilepathLink } from "@/utils/linkOpen";
import { LinkPopupView } from "./LinkPopupView";
import "./link-popup.css";

const linkPopupPluginKey = new PluginKey("linkPopup");

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/** Finds the range of a link mark at the given document position, or null. */
export function findLinkMarkRange(view: EditorView, pos: number): MarkRange | null {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  // First pass: find the link mark at the given position
  let linkMark: Mark | null = null;
  let currentOffset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentStart + currentOffset;
    const childTo = childFrom + child.nodeSize;

    if (pos >= childFrom && pos < childTo && child.isText) {
      const mark = child.marks.find((m) => m.type.name === "link");
      if (mark) {
        linkMark = mark;
        break;
      }
    }
    currentOffset += child.nodeSize;
  }

  if (!linkMark) return null;

  // Second pass: find the continuous range with the same href that contains pos
  const targetHref = linkMark.attrs.href;
  currentOffset = 0;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childFrom = parentStart + currentOffset;

    if (child.isText) {
      const mark = child.marks.find(
        (m) => m.type.name === "link" && m.attrs.href === targetHref
      );

      if (mark) {
        const rangeFrom = childFrom;
        let rangeTo = childFrom + child.nodeSize;
        const foundMark = mark;

        // Continue checking subsequent children for continuous marks with same href
        let j = i + 1;
        while (j < parent.childCount) {
          const nextChild = parent.child(j);
          if (nextChild.isText) {
            const nextMark = nextChild.marks.find(
              (m) => m.type.name === "link" && m.attrs.href === targetHref
            );
            if (nextMark) {
              rangeTo += nextChild.nodeSize;
              j++;
            } else {
              break;
            }
          } else {
            break;
          }
        }

        if (pos >= rangeFrom && pos < rangeTo) {
          return { mark: foundMark, from: rangeFrom, to: rangeTo };
        }

        currentOffset = rangeTo - parentStart;
        i = j - 1;
        continue;
      }
    }
    currentOffset += child.nodeSize;
  }

  return null;
}

/**
 * Click handler: Cmd/Ctrl+click opens link in browser, navigates to fragment,
 * or opens a target file in a new tab. Regular click on a link opens the
 * edit popup. Regular click elsewhere closes any open popups.
 */
function handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
  try {
    // Cmd/Ctrl + click: open link, navigate to fragment, or open target file
    if (event.metaKey || event.ctrlKey) {
      const linkRange = findLinkMarkRange(view, pos);
      if (linkRange) {
        const href = linkRange.mark.attrs.href as string;
        if (href) {
          const kind = classifyHref(href);

          if (kind === "fragment") {
            const targetId = href.slice(1);
            if (navigateToHeadingById(view, targetId)) {
              event.preventDefault();
              return true;
            }
            return false;
          }

          if (kind === "external") {
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
              openUrl(href).catch(linkPopupError);
            }).catch(linkPopupError);
            event.preventDefault();
            return true;
          }

          // Filepath — resolve relative to active doc, open in a tab.
          openFilepathLink(href).catch(linkPopupError);
          event.preventDefault();
          return true;
        }
      }
      return false;
    }

    // Regular click on a link: open the edit popup
    const linkRange = findLinkMarkRange(view, pos);
    if (linkRange) {
      const href = linkRange.mark.attrs.href as string;
      if (href) {
        // Close create popup if open
        if (useLinkCreatePopupStore.getState().isOpen) {
          useLinkCreatePopupStore.getState().closePopup();
        }

        // Compute anchor rect from link range coordinates
        const startCoords = view.coordsAtPos(linkRange.from);
        const endCoords = view.coordsAtPos(linkRange.to);
        const anchorRect = {
          top: startCoords.top,
          left: startCoords.left,
          bottom: startCoords.bottom,
          right: endCoords.right,
        };

        useLinkPopupStore.getState().openPopup({
          href,
          linkFrom: linkRange.from,
          linkTo: linkRange.to,
          anchorRect,
        });
        return false; // let ProseMirror place cursor normally
      }
    }

    // Regular click not on a link: close all link popups
    if (useLinkPopupStore.getState().isOpen) {
      useLinkPopupStore.getState().closePopup();
    }
    if (useLinkCreatePopupStore.getState().isOpen) {
      useLinkCreatePopupStore.getState().closePopup();
    }

    return false;
  } catch (error) {
    linkPopupError("Click handler error:", error);
    return false;
  }
}

/**
 * Plugin view - manages the popup view for link editing.
 * Triggered by clicking a link or via Cmd+K.
 */
class LinkPopupPluginView {
  private popupView: LinkPopupView;

  constructor(view: EditorView) {
    this.popupView = new LinkPopupView(view);
  }

  update() {
    // Popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

/** Tiptap extension that shows a popup when the cursor is on a link. */
export const linkPopupExtension = Extension.create({
  name: "linkPopup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkPopupPluginKey,
        view: (editorView) => new LinkPopupPluginView(editorView),
        props: { handleClick },
      }),
    ];
  },
});
