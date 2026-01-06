/**
 * Link Popup Plugin (Tiptap)
 *
 * Reuses the existing DOM popup view (`LinkPopupView`) and store (`linkPopupStore`),
 * but wires it into Tiptap via `addProseMirrorPlugins`.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Mark } from "@tiptap/pm/model";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { LinkPopupView } from "./LinkPopupView";

const linkPopupPluginKey = new PluginKey("linkPopup");

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

function findLinkMarkRange(view: EditorView, pos: number): MarkRange | null {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

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
          return;
        }
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

function handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
  try {
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

    const linkRange = findLinkMarkRange(view, pos);

    if (linkRange) {
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

      return false;
    }

    if (useLinkPopupStore.getState().isOpen) {
      useLinkPopupStore.getState().closePopup();
    }

    return false;
  } catch (error) {
    console.error("[LinkPopup] Click handler error:", error);
    return false;
  }
}

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

