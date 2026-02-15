/**
 * Media Popup View
 *
 * Purpose: Manages the DOM for the media editing popup — shows on video/audio click
 * with controls for editing src path, title, poster (video), browsing files,
 * copying path, and removing.
 *
 * Key decisions:
 *   - Store-driven: subscribes to mediaPopupStore for visibility and position updates
 *   - Mirrors ImagePopupView architecture: DOM helper + actions module + view class
 *   - justOpened guard prevents same-click open/close race
 *   - pendingCloseRaf defers outside-click close to allow reopen on different node
 *   - Scroll-close keeps popup position fresh
 *   - Tab-trapping + IME guard for keyboard accessibility
 *
 * @coordinates-with mediaPopupDom.ts — DOM element construction
 * @coordinates-with mediaPopupActions.ts — browse and replace media logic
 * @coordinates-with stores/mediaPopupStore.ts — popup state
 * @module plugins/mediaPopup/MediaPopupView
 */

import "./media-popup.css";
import type { EditorView } from "@tiptap/pm/view";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { createMediaPopupDom, installMediaPopupKeyboardNavigation } from "./mediaPopupDom";
import { browseAndReplaceMedia } from "./mediaPopupActions";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

export class MediaPopupView {
  private container: HTMLElement;
  private srcInput: HTMLInputElement;
  private titleInput: HTMLInputElement;
  private posterInput: HTMLInputElement;
  private posterRow: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private removeKeyboardNavigation: (() => void) | null = null;
  private pendingCloseRaf: number | null = null;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    const dom = createMediaPopupDom({
      onBrowse: this.handleBrowse,
      onCopy: this.handleCopy,
      onRemove: this.handleRemove,
      onInputKeydown: this.handleInputKeydown,
    });
    this.container = dom.container;
    this.srcInput = dom.srcInput;
    this.titleInput = dom.titleInput;
    this.posterInput = dom.posterInput;
    this.posterRow = dom.posterRow;

    // Live input updates to store + node attrs
    this.srcInput.addEventListener("input", this.handleSrcChange);
    this.titleInput.addEventListener("input", this.handleTitleChange);
    this.posterInput.addEventListener("input", this.handlePosterChange);

    // Subscribe to store changes — show() on open transition or data change
    this.unsubscribe = useMediaPopupStore.subscribe((state, prevState) => {
      if (state.isOpen && state.anchorRect) {
        // Cancel any pending close — popup is being (re)opened
        if (this.pendingCloseRaf !== null) {
          cancelAnimationFrame(this.pendingCloseRaf);
          this.pendingCloseRaf = null;
        }
        // Show on open transition or when target node changes (click different media)
        const nodeChanged = this.wasOpen && state.mediaNodePos !== prevState.mediaNodePos;
        if (!this.wasOpen || nodeChanged) {
          this.show(
            state.mediaSrc,
            state.mediaTitle,
            state.mediaPoster,
            state.mediaNodeType,
            state.anchorRect
          );
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);

    // Close popup on scroll (popup position becomes stale)
    this.editorView.dom
      .closest(".editor-container")
      ?.addEventListener("scroll", this.handleScroll, true);
  }

  private show(
    src: string,
    title: string,
    poster: string,
    mediaType: string,
    anchorRect: AnchorRect
  ): void {
    this.srcInput.value = src;
    this.titleInput.value = title;
    this.posterInput.value = poster;

    // Show poster row only for video
    this.posterRow.style.display = mediaType === "block_video" ? "" : "none";

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    // Set guard to prevent immediate close from same click event
    this.justOpened = true;
    requestAnimationFrame(() => {
      this.justOpened = false;
    });

    // Get boundaries: horizontal from ProseMirror, vertical from container
    const containerEl = this.editorView.dom.closest(
      ".editor-container"
    ) as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // Calculate position using utility
    const popupHeight = mediaType === "block_video" ? 96 : 68;
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 340, height: popupHeight },
      bounds,
      gap: 6,
      preferAbove: false,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (this.host !== document.body) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }

    // Set up keyboard navigation with ESC handler
    if (this.removeKeyboardNavigation) {
      this.removeKeyboardNavigation();
    }
    this.removeKeyboardNavigation = installMediaPopupKeyboardNavigation(
      this.container,
      () => {
        useMediaPopupStore.getState().closePopup();
        this.editorView.focus();
      }
    );

    // Focus src input
    requestAnimationFrame(() => {
      this.srcInput.focus();
      this.srcInput.select();
    });
  }

  private hide(): void {
    this.container.style.display = "none";
    this.host = null;
    if (this.removeKeyboardNavigation) {
      this.removeKeyboardNavigation();
      this.removeKeyboardNavigation = null;
    }
  }

  private handleInputKeydown = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      useMediaPopupStore.getState().closePopup();
      this.editorView.focus();
    }
  };

  private handleSave = () => {
    const state = useMediaPopupStore.getState();
    const { mediaNodePos } = state;
    const newSrc = this.srcInput.value.trim();
    const newTitle = this.titleInput.value.trim();
    const newPoster = this.posterInput.value.trim();

    if (!newSrc) {
      // Empty src — remove the media node
      this.handleRemove();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(mediaNodePos);
      if (!node || (node.type.name !== "block_video" && node.type.name !== "block_audio")) return;

      const tr = editorState.tr.setNodeMarkup(mediaNodePos, null, {
        ...node.attrs,
        src: newSrc,
        title: newTitle,
        poster: newPoster,
      });

      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[MediaPopup] Save failed:", error);
      state.closePopup();
    }
  };

  private handleSrcChange = () => {
    const value = this.srcInput.value;
    useMediaPopupStore.getState().setSrc(value);
    this.updateNodeAttr("src", value);
  };

  private handleTitleChange = () => {
    const value = this.titleInput.value;
    useMediaPopupStore.getState().setTitle(value);
    this.updateNodeAttr("title", value);
  };

  private handlePosterChange = () => {
    const value = this.posterInput.value;
    useMediaPopupStore.getState().setPoster(value);
    this.updateNodeAttr("poster", value);
  };

  private handleBrowse = async () => {
    const state = useMediaPopupStore.getState();
    const updated = await browseAndReplaceMedia(
      this.editorView,
      state.mediaNodePos,
      state.mediaNodeType
    );
    if (updated) {
      state.closePopup();
      this.editorView.focus();
    }
  };

  private handleCopy = async () => {
    const { mediaSrc } = useMediaPopupStore.getState();
    if (mediaSrc) {
      try {
        await navigator.clipboard.writeText(mediaSrc);
      } catch (err) {
        console.error("Failed to copy media path:", err);
      }
    }
    useMediaPopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleRemove = () => {
    const state = useMediaPopupStore.getState();
    const { mediaNodePos } = state;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(mediaNodePos);
      if (!node || (node.type.name !== "block_video" && node.type.name !== "block_audio")) return;

      const tr = editorState.tr.delete(mediaNodePos, mediaNodePos + node.nodeSize);
      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[MediaPopup] Remove failed:", error);
      state.closePopup();
    }
  };

  private handleScroll = () => {
    if (useMediaPopupStore.getState().isOpen) {
      useMediaPopupStore.getState().closePopup();
    }
  };

  private handleClickOutside = (e: MouseEvent) => {
    // Guard against race condition where same click opens and closes popup
    if (this.justOpened) return;

    const { isOpen } = useMediaPopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      // Defer the close to next frame — allows click handler to fire first
      // and potentially reopen/update the popup (e.g., clicking a different media node)
      if (this.pendingCloseRaf === null) {
        this.pendingCloseRaf = requestAnimationFrame(() => {
          this.pendingCloseRaf = null;
          // Re-check if popup should still close (might have been reopened)
          const currentState = useMediaPopupStore.getState();
          if (currentState.isOpen && !this.container.contains(document.activeElement)) {
            useMediaPopupStore.getState().closePopup();
          }
        });
      }
    }
  };

  private updateNodeAttr(attr: string, value: string): void {
    const { mediaNodePos } = useMediaPopupStore.getState();
    if (mediaNodePos < 0) return;

    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(mediaNodePos);
    if (!node) return;

    const tr = state.tr.setNodeMarkup(mediaNodePos, undefined, {
      ...node.attrs,
      [attr]: value,
    });
    dispatch(tr);
  }

  destroy(): void {
    this.unsubscribe();
    if (this.removeKeyboardNavigation) {
      this.removeKeyboardNavigation();
      this.removeKeyboardNavigation = null;
    }
    if (this.pendingCloseRaf !== null) {
      cancelAnimationFrame(this.pendingCloseRaf);
      this.pendingCloseRaf = null;
    }
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.editorView.dom
      .closest(".editor-container")
      ?.removeEventListener("scroll", this.handleScroll, true);
    this.container.remove();
  }
}
