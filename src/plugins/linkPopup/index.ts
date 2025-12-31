/**
 * Link Popup Plugin
 *
 * Click on a link to show a popup for editing/opening/copying/removing.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Mark } from "@milkdown/kit/prose/model";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { LinkPopupView } from "./LinkPopupView";

export const linkPopupPluginKey = new PluginKey("linkPopup");

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * Find the full range of a link mark at the given position.
 */
function findLinkMarkRange(view: EditorView, pos: number): MarkRange | null {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  // Check if there's a link mark at this position
  let linkMark: Mark | null = null;

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    if (pos >= from && pos < to && child.isText) {
      const mark = child.marks.find((m) => m.type.name === "link");
      if (mark) {
        linkMark = mark;
      }
    }
  });

  if (!linkMark) return null;

  // Find the full range of this mark
  let from = -1;
  let to = -1;
  let foundMark: Mark | null = null;

  parent.forEach((child, childOffset) => {
    const childFrom = parentStart + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText) {
      const mark = child.marks.find(
        (m) => m.type.name === "link" && m.attrs.href === linkMark!.attrs.href
      );

      if (mark) {
        if (from === -1) {
          from = childFrom;
          foundMark = mark;
        }
        to = childTo;
      } else if (from !== -1) {
        // End of continuous mark range
        if (pos >= from && pos < to) {
          return; // Found it, stop
        }
        // Reset for next potential range
        from = -1;
        to = -1;
        foundMark = null;
      }
    }
  });

  if (from !== -1 && to !== -1 && foundMark && pos >= from && pos < to) {
    return { mark: foundMark, from, to };
  }

  return null;
}

/**
 * Handle click on editor - check if clicked on a link.
 */
function handleClick(
  view: EditorView,
  pos: number,
  event: MouseEvent
): boolean {
  try {
    // Ignore if modifier keys are pressed (Cmd+click should open link)
    if (event.metaKey || event.ctrlKey) {
      const linkRange = findLinkMarkRange(view, pos);
      if (linkRange) {
        const href = linkRange.mark.attrs.href;
        if (href) {
          import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
            openUrl(href).catch(console.error);
          });
          event.preventDefault();
          return true;
        }
      }
      return false;
    }

    // Find link mark at clicked position
    const linkRange = findLinkMarkRange(view, pos);

    if (linkRange) {
      // Get coordinates for popup positioning (start and end of link)
      const startCoords = view.coordsAtPos(linkRange.from);
      const endCoords = view.coordsAtPos(linkRange.to);

      useLinkPopupStore.getState().openPopup({
        href: linkRange.mark.attrs.href || "",
        linkFrom: linkRange.from,
        linkTo: linkRange.to,
        anchorRect: {
          top: startCoords.top,
          left: startCoords.left,
          bottom: startCoords.bottom,
          right: endCoords.right,
        },
      });

      // Don't prevent default - let normal click behavior continue
      return false;
    }

    // Close popup if clicking elsewhere
    const { isOpen } = useLinkPopupStore.getState();
    if (isOpen) {
      useLinkPopupStore.getState().closePopup();
    }

    return false;
  } catch (error) {
    console.error("[LinkPopup] Click handler error:", error);
    return false;
  }
}

/**
 * Plugin view that manages the LinkPopupView lifecycle.
 */
class LinkPopupPluginView implements PluginView {
  private popupView: LinkPopupView;

  constructor(view: EditorView) {
    this.popupView = new LinkPopupView(view);
  }

  update() {
    // No-op - popup updates via store subscription
  }

  destroy() {
    this.popupView.destroy();
  }
}

/**
 * Link popup plugin for Milkdown.
 */
export const linkPopupPlugin = $prose(() => {
  return new Plugin({
    key: linkPopupPluginKey,
    view(editorView) {
      return new LinkPopupPluginView(editorView);
    },
    props: {
      handleClick,
    },
  });
});

export default linkPopupPlugin;
