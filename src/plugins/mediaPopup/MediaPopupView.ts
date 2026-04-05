/**
 * Media Popup View
 *
 * Purpose: Manages the DOM for the unified media editing popup — shows on click for
 * all 4 media types (image, block_image, block_video, block_audio) with controls for
 * editing src path, alt text, title, poster, toggling inline/block, browsing files,
 * copying path, and removing.
 *
 * Key decisions:
 *   - Store-driven: subscribes to mediaPopupStore for visibility and position updates
 *   - Conditional rows: alt row for images, title row for video/audio, poster row for video
 *   - Toggle button only visible for image types (inline ↔ block)
 *   - Copy resolves relative paths to absolute via document directory for external tool compatibility
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
import { dirname, join } from "@tauri-apps/api/path";
import { mediaPopupWarn, mediaPopupError } from "@/utils/debug";
import { useMediaPopupStore, type MediaNodeType } from "@/stores/mediaPopupStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getActiveTabIdForCurrentWindow } from "@/utils/resolveMediaSrc";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import {
  createMediaPopupDom,
  installMediaPopupKeyboardNavigation,
  updateMediaPopupToggleButton,
} from "./mediaPopupDom";
import { browseAndReplaceMedia } from "./mediaPopupActions";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";
import type { ImageDimensions } from "@/types/image";

/** Approximate popup height by media type (rows × ~24px row height + padding). */
const POPUP_HEIGHT: Record<MediaNodeType, number> = {
  image: 72,       // src + alt rows
  block_image: 72, // src + alt rows
  block_video: 96, // src + title + poster rows
  block_audio: 68, // src + title rows
};

/** Popup width used for position calculation. */
const POPUP_WIDTH = 340;

/** Gap between anchor element and popup. */
const POPUP_GAP = 6;

/** Get popup height based on media type. */
function getPopupHeightForType(type: MediaNodeType): number {
  return POPUP_HEIGHT[type];
}

/** Check if a media type is an image type. */
function isImageType(type: MediaNodeType): boolean {
  return type === "image" || type === "block_image";
}

export class MediaPopupView {
  private container: HTMLElement;
  private srcInput: HTMLInputElement;
  private altRow: HTMLElement;
  private altInput: HTMLInputElement;
  private dimensionsSpan: HTMLElement;
  private titleRow: HTMLElement;
  private titleInput: HTMLInputElement;
  private posterInput: HTMLInputElement;
  private posterRow: HTMLElement;
  private toggleBtn: HTMLElement;
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
      onToggle: this.handleToggle,
      onRemove: this.handleRemove,
      onInputKeydown: this.handleInputKeydown,
    });
    this.container = dom.container;
    this.srcInput = dom.srcInput;
    this.altRow = dom.altRow;
    this.altInput = dom.altInput;
    this.dimensionsSpan = dom.dimensionsSpan;
    this.titleRow = dom.titleRow;
    this.titleInput = dom.titleInput;
    this.posterInput = dom.posterInput;
    this.posterRow = dom.posterRow;
    this.toggleBtn = dom.toggleBtn;

    // Live input updates to store + node attrs
    this.srcInput.addEventListener("input", this.handleSrcChange);
    this.altInput.addEventListener("input", this.handleAltChange);
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
        if ((!this.wasOpen || nodeChanged) && state.anchorRect) {
          this.show({ ...state, anchorRect: state.anchorRect });
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

  private show(state: {
    mediaSrc: string;
    mediaAlt: string;
    mediaTitle: string;
    mediaPoster: string;
    mediaNodeType: MediaNodeType;
    mediaDimensions: ImageDimensions | null;
    anchorRect: AnchorRect;
  }): void {
    const { mediaSrc, mediaAlt, mediaTitle, mediaPoster, mediaNodeType, mediaDimensions, anchorRect } = state;
    const isImage = isImageType(mediaNodeType);
    const isVideo = mediaNodeType === "block_video";

    // Set input values
    this.srcInput.value = mediaSrc;
    this.altInput.value = mediaAlt;
    this.titleInput.value = mediaTitle;
    this.posterInput.value = mediaPoster;

    // Conditional row visibility
    this.altRow.style.display = isImage ? "" : "none";
    this.titleRow.style.display = isImage ? "none" : "";
    this.posterRow.style.display = isVideo ? "" : "none";
    this.toggleBtn.style.display = isImage ? "" : "none";

    // Dimensions: only for images with valid values
    if (isImage && mediaDimensions && mediaDimensions.width > 0 && mediaDimensions.height > 0) {
      this.dimensionsSpan.textContent = `${mediaDimensions.width} × ${mediaDimensions.height} px`;
      this.dimensionsSpan.style.display = "";
    } else {
      this.dimensionsSpan.textContent = "";
      this.dimensionsSpan.style.display = "none";
    }

    // Update toggle button icon based on current type
    if (isImage) {
      updateMediaPopupToggleButton(this.toggleBtn, mediaNodeType);
    }

    // Mount to editor container — popups must be inside editor container, not document.body
    this.host = getPopupHostForDom(this.editorView.dom);
    if (!this.host) {
      mediaPopupWarn("No editor container found for popup host");
      return;
    }
    if (this.container.parentElement !== this.host) {
      this.container.style.position = "absolute";
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
    const popupHeight = getPopupHeightForType(mediaNodeType);
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: POPUP_WIDTH, height: popupHeight },
      bounds,
      gap: POPUP_GAP,
      preferAbove: isImage,
    });

    // Convert to host-relative coordinates (mounted inside editor container)
    const hostPos = toHostCoordsForDom(this.host, { top, left });
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;

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
    /* v8 ignore start -- @preserve non-Enter/Escape keys pass through */
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      useMediaPopupStore.getState().closePopup();
      this.editorView.focus();
    }
    /* v8 ignore stop */
  };

  private handleSave = () => {
    const state = useMediaPopupStore.getState();
    const { mediaNodePos, mediaNodeType } = state;
    const newSrc = this.srcInput.value.trim();

    if (!newSrc) {
      this.handleRemove();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.editorView;
      /* v8 ignore next -- @preserve editorView.state always present; null guard is defensive */
      if (!editorState) return;

      const node = editorState.doc.nodeAt(mediaNodePos);
      if (!node || node.type.name !== mediaNodeType) return;

      // Type-aware attribute assembly
      const attrs = isImageType(mediaNodeType)
        ? { ...node.attrs, src: newSrc, alt: this.altInput.value.trim() }
        : { ...node.attrs, src: newSrc, title: this.titleInput.value.trim(), poster: this.posterInput.value.trim() };

      const tr = editorState.tr.setNodeMarkup(mediaNodePos, null, attrs);
      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      mediaPopupError("Save failed:", error);
      state.closePopup();
    }
  };

  private handleToggle = () => {
    const state = useMediaPopupStore.getState();
    const { mediaNodePos, mediaNodeType } = state;

    if (!isImageType(mediaNodeType)) return;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(mediaNodePos);
      if (!node) return;

      const attrs = { ...node.attrs };
      const targetType = mediaNodeType === "block_image" ? "image" : "block_image";
      const newNodeType = editorState.schema.nodes[targetType];
      if (!newNodeType) {
        mediaPopupWarn(`${targetType} schema not available`);
        return;
      }

      const newNode = newNodeType.create(attrs);
      const tr = editorState.tr.replaceWith(mediaNodePos, mediaNodePos + node.nodeSize, newNode);
      dispatch(tr);

      useMediaPopupStore.getState().closePopup();
    } catch (error) {
      mediaPopupError("Toggle failed:", error);
    }
  };

  private handleSrcChange = () => {
    const value = this.srcInput.value;
    useMediaPopupStore.getState().setSrc(value);
    this.updateNodeAttr("src", value);
  };

  private handleAltChange = () => {
    const value = this.altInput.value;
    useMediaPopupStore.getState().setAlt(value);
    this.updateNodeAttr("alt", value);
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
      // Resolve relative paths to absolute
      let pathToCopy = mediaSrc;
      if (!mediaSrc.startsWith("/") && !mediaSrc.startsWith("http")) {
        const tabId = getActiveTabIdForCurrentWindow();
        const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : undefined;
        const filePath = doc?.filePath;
        if (filePath) {
          try {
            const docDir = await dirname(filePath);
            const cleanPath = mediaSrc.replace(/^\.\//, "");
            pathToCopy = await join(docDir, cleanPath);
          } catch {
            // Fall back to raw src if resolution fails
          }
        }
      }
      try {
        await navigator.clipboard.writeText(pathToCopy);
      } catch (err) {
        mediaPopupError("Failed to copy media path:", err);
      }
    }
    useMediaPopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleRemove = () => {
    const state = useMediaPopupStore.getState();
    const { mediaNodePos, mediaNodeType } = state;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(mediaNodePos);
      if (!node || node.type.name !== mediaNodeType) return;

      const tr = editorState.tr.delete(mediaNodePos, mediaNodePos + node.nodeSize);
      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      mediaPopupError("Remove failed:", error);
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
    const { mediaNodePos, mediaNodeType } = useMediaPopupStore.getState();
    if (mediaNodePos < 0) return;

    try {
      const { state, dispatch } = this.editorView;
      const node = state.doc.nodeAt(mediaNodePos);
      if (!node || node.type.name !== mediaNodeType) return;

      const tr = state.tr.setNodeMarkup(mediaNodePos, undefined, {
        ...node.attrs,
        [attr]: value,
      });
      dispatch(tr);
    } catch {
      // Silently ignore — doc may have changed while popup is open
    }
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
