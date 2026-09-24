/**
 * Link Popup Plugin (Tiptap)
 *
 * Handles Cmd+Click to open links — heading navigation for `#fragment`,
 * browser open for external URLs, and tab open for cross-file links
 * (relative or absolute filesystem paths) resolved against the active
 * document's directory.
 *
 * Regular click on a link opens the edit popup WITHOUT taking focus, so the
 * link text stays editable (#1448); the popup closes as soon as that editing
 * makes its snapshot stale. Cmd+K opens it focused for an explicit URL edit
 * (handled in editorPlugins.tiptap.ts).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { linkPopupError } from "@/utils/debug";
import type { StoreApi } from "zustand";
import type { PopupStoreBase } from "@/plugins/shared";
import type { LinkPopupState } from "@/plugins/shared/popupPorts";
import { activeFilePathForCurrentWindow, hostDocument } from "@/plugins/shared/hostDocument";
import { navigateToHeadingById } from "@/utils/headingSlug";
import { classifyLinkAction } from "./operations";
import { LinkPopupView } from "./LinkPopupView";
import { findLinkMarkRange } from "./findLinkMarkRange";
import "./link-popup.css";
import { openExternalLink, openFilepathLink, openLinkTarget } from "@/services/navigation/linkOpen";

export { findLinkMarkRange };

const linkPopupPluginKey = new PluginKey("linkPopup");

/**
 * Click handler: Cmd/Ctrl+click opens link in browser, navigates to fragment,
 * or opens a target file in a new tab. Regular click on a link opens the
 * edit popup. Regular click elsewhere closes any open popups.
 */
function makeHandleClick(
  store: StoreApi<LinkPopupState>,
  createStore: StoreApi<PopupStoreBase>
) {
  return function handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
  try {
    // Cmd/Ctrl + click: open link, navigate to fragment, or open target file
    if (event.metaKey || event.ctrlKey) {
      const linkRange = findLinkMarkRange(view, pos);
      if (linkRange) {
        const href = linkRange.mark.attrs.href as string;
        if (href) {
          // ADR-010: classification comes from shared operations.ts, and every
          // open goes through services/navigation/linkOpen, as in Source mode.
          const action = classifyLinkAction(href);
          if (action.kind === "fragment") {
            if (navigateToHeadingById(view, action.targetId)) {
              event.preventDefault();
              return true;
            }
            return false;
          }
          if (action.kind === "external") {
            // Scheme-allowlisted opener (audit 20260612) — a hostile doc
            // must not reach file:/javascript:/smb: via the OS opener.
            openExternalLink(href).catch(linkPopupError);
            event.preventDefault();
            return true;
          }
          if (action.kind === "filepath") {
            const sourcePath = hostDocument.activeFilePath(
              getCurrentWebviewWindow().label
            );
            void openFilepathLink(href, sourcePath);
            event.preventDefault();
            return true;
          }
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
        if (createStore.getState().isOpen) {
          createStore.getState().closePopup();
        }

        // Compute anchor rect from link range coordinates. When the link wraps
        // across lines its end sits on a later line: pairing the first line's
        // left edge with the last line's right edge yields an incoherent (often
        // inverted) rect, so anchor on the first line only.
        const startCoords = view.coordsAtPos(linkRange.from);
        const endCoords = view.coordsAtPos(linkRange.to);
        const wrapped = endCoords.top > startCoords.top;
        const anchorRect = {
          top: startCoords.top,
          left: startCoords.left,
          bottom: startCoords.bottom,
          right: wrapped ? startCoords.left : endCoords.right,
        };

        store.getState().openPopup({
          href,
          linkFrom: linkRange.from,
          linkTo: linkRange.to,
          anchorRect,
          autoFocus: false,
        });
        return false; // let ProseMirror place cursor normally
      }
    }

    // Regular click not on a link: close all link popups
    if (store.getState().isOpen) store.getState().closePopup();
    if (createStore.getState().isOpen) createStore.getState().closePopup();

    return false;
  } catch (error) {
    linkPopupError("Click handler error:", error);
    return false;
  }
  };
}

/**
 * Native `click` on a link anchor: mark it handled, and activate what
 * `handleClick` cannot reach.
 *
 * VMark activates links itself — `handleClick`, which ProseMirror runs on
 * MOUSEUP, so its `preventDefault` never reaches the native click that follows.
 * That click still bubbles to `tauri-plugin-opener`'s window listener, which
 * opens any Ctrl/Shift-clicked anchor whose resolved href is `http(s):` in the
 * OS browser unless the event is already defaultPrevented. On Windows the app
 * origin is `http://tauri.localhost`, so `A.md` became
 * `http://tauri.localhost/A.md` in the browser and a scheme-less href like
 * `C:\…` (rendered as `href=""`) became the app's own URL (#1448). macOS's
 * `tauri://` origin never matched, which is why it was Windows-only.
 *
 * Registered on the editor DOM, not as a ProseMirror handler: the image node
 * view's `stopEvent` keeps clicks from ProseMirror entirely, so a handler there
 * would never see a click on a linked image — and neither does `handleClick`,
 * which is why a modified click on a linked non-text node is activated here.
 */
function handleNativeLinkClick(view: EditorView, event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a");
  const link = view.state.schema.marks.link;
  if (!target || !anchor || !link || !view.dom.contains(anchor)) return;
  try {
    // The node the anchor opens on — text or an inline image — must carry a
    // link mark, i.e. the anchor is one of ours.
    const first = view.state.doc.resolve(view.posAtDOM(anchor, 0)).nodeAfter;
    if (!first || !link.isInSet(first.marks)) return;
    event.preventDefault();
    if (!event.metaKey && !event.ctrlKey) return;

    const at = view.posAtDOM(target, 0);
    const clicked = view.state.doc.nodeAt(at);
    const clickedDom = view.nodeDOM(at);
    if (!clicked || clicked.isText || !clickedDom?.contains(target)) return;
    const href = link.isInSet(clicked.marks)?.attrs.href as string | undefined;
    if (href) {
      void openLinkTarget(href, activeFilePathForCurrentWindow(), (id) =>
        navigateToHeadingById(view, id)
      );
    }
  } catch (error) {
    // posAtDOM throws for DOM outside the document content (node-view chrome).
    linkPopupError("Native link click:", error);
  }
}

/**
 * Plugin view - manages the popup view for link editing.
 * Triggered by clicking a link or via Cmd+K.
 */
class LinkPopupPluginView {
  private popupView: LinkPopupView;
  private store: StoreApi<LinkPopupState>;
  private view: EditorView;

  constructor(view: EditorView, store: StoreApi<LinkPopupState>) {
    this.view = view;
    this.store = store;
    this.popupView = new LinkPopupView(view, store);
    view.dom.addEventListener("click", this.onNativeClick);
  }

  private onNativeClick = (event: MouseEvent) => handleNativeLinkClick(this.view, event);

  /**
   * A click-opened popup leaves the keyboard in the document (#1448). When the
   * user edits there, or moves the caret off the link, the popup's snapshot of
   * the link is stale — close it rather than let a later save act on it.
   * Changes arriving while the popup itself has focus (MCP edits) are left to
   * the save path's own range guard, as before.
   */
  update(view: EditorView, prevState: EditorState) {
    const popup = this.store.getState();
    if (!popup.isOpen || !view.hasFocus()) return;
    const docChanged = view.state.doc !== prevState.doc;
    const { head } = view.state.selection;
    if (docChanged || head < popup.linkFrom || head > popup.linkTo) {
      popup.closePopup();
    }
  }

  destroy() {
    this.view.dom.removeEventListener("click", this.onNativeClick);
    this.popupView.destroy();
  }
}

/** Tiptap extension that shows a popup when the cursor is on a link. */
export interface LinkPopupOptions {
  /** The edit popup's state — a PORT, no default (ADR-015). */
  store: StoreApi<LinkPopupState>;
  /** The create popup's, which this plugin only dismisses. */
  createStore: StoreApi<PopupStoreBase>;
}

export const linkPopupExtension = Extension.create<LinkPopupOptions>({
  name: "linkPopup",
  addOptions() {
    return {
      store: undefined as unknown as StoreApi<LinkPopupState>,
      createStore: undefined as unknown as StoreApi<PopupStoreBase>,
    };
  },
  addProseMirrorPlugins() {
    const { store, createStore } = this.options;
    if (!store || !createStore) {
      throw new Error(
        "linkPopupExtension requires `store` and `createStore` options — see services/assembly/tiptapExtensions.ts"
      );
    }
    return [
      new Plugin({
        key: linkPopupPluginKey,
        view: (editorView) => new LinkPopupPluginView(editorView, store),
        props: { handleClick: makeHandleClick(store, createStore) },
      }),
    ];
  },
});
