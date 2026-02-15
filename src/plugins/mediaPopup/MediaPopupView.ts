/**
 * Media Popup View
 *
 * Purpose: Manages the DOM for the media editing popup — shows on video/audio click
 * with controls for editing src path, title, poster (video), and removing.
 *
 * Key decisions:
 *   - Store-driven: subscribes to mediaPopupStore for visibility and position updates
 *   - Positioned using shared popup positioning relative to the media element
 *   - Uses shared popup styles from popup-shared.css
 *
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
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

export class MediaPopupView {
  private container: HTMLElement;
  private srcInput: HTMLInputElement;
  private titleInput: HTMLInputElement;
  private posterRow: HTMLElement;
  private posterInput: HTMLInputElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private wasOpen = false;
  private host: HTMLElement | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build popup DOM
    this.container = document.createElement("div");
    this.container.className = "media-popup popup-container";
    this.container.style.display = "none";

    // Row 1: src input + remove button
    const row1 = document.createElement("div");
    row1.className = "media-popup-row";

    this.srcInput = document.createElement("input");
    this.srcInput.className = "popup-input popup-input--mono popup-input--full";
    this.srcInput.type = "text";
    this.srcInput.placeholder = "Media source path or URL";
    this.srcInput.addEventListener("input", this.handleSrcChange);
    this.srcInput.addEventListener("keydown", this.handleKeydown);

    const removeBtn = document.createElement("button");
    removeBtn.className = "popup-icon-btn popup-icon-btn--danger";
    removeBtn.title = "Remove";
    removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;
    removeBtn.addEventListener("click", this.handleRemove);

    row1.appendChild(this.srcInput);
    row1.appendChild(removeBtn);
    this.container.appendChild(row1);

    // Row 2: title input
    const row2 = document.createElement("div");
    row2.className = "media-popup-row";

    this.titleInput = document.createElement("input");
    this.titleInput.className = "popup-input popup-input--full";
    this.titleInput.type = "text";
    this.titleInput.placeholder = "Title (optional)";
    this.titleInput.addEventListener("input", this.handleTitleChange);
    this.titleInput.addEventListener("keydown", this.handleKeydown);

    row2.appendChild(this.titleInput);
    this.container.appendChild(row2);

    // Row 3: poster input (video only, hidden for audio)
    this.posterRow = document.createElement("div");
    this.posterRow.className = "media-popup-row";

    this.posterInput = document.createElement("input");
    this.posterInput.className = "popup-input popup-input--mono popup-input--full";
    this.posterInput.type = "text";
    this.posterInput.placeholder = "Poster image (optional)";
    this.posterInput.addEventListener("input", this.handlePosterChange);
    this.posterInput.addEventListener("keydown", this.handleKeydown);

    this.posterRow.appendChild(this.posterInput);
    this.container.appendChild(this.posterRow);

    // Subscribe to store changes
    this.unsubscribe = useMediaPopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        if (!this.wasOpen) {
          this.show(state.mediaSrc, state.mediaTitle, state.mediaPoster, state.mediaNodeType, state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    // Close on outside click
    document.addEventListener("mousedown", this.handleOutsideClick);
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

    // Ensure container is attached
    if (!this.host) {
      this.host = getPopupHostForDom(this.editorView.dom) ?? this.editorView.dom.parentElement;
    }
    if (this.host && !this.host.contains(this.container)) {
      this.host.appendChild(this.container);
    }

    this.container.style.display = "";

    // Position popup
    requestAnimationFrame(() => {
      // Get boundaries: horizontal from ProseMirror, vertical from container
      const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
      const bounds = containerEl
        ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
        : getViewportBounds();

      const popupRect = this.container.getBoundingClientRect();
      const { top, left } = calculatePopupPosition({
        anchor: anchorRect,
        popup: { width: popupRect.width, height: popupRect.height },
        bounds,
        gap: 8,
        preferAbove: false,
      });

      // Convert to host-relative coordinates if mounted inside editor container
      if (this.host && this.host !== document.body) {
        const hostPos = toHostCoordsForDom(this.host, { top, left });
        this.container.style.top = `${hostPos.top}px`;
        this.container.style.left = `${hostPos.left}px`;
      } else {
        this.container.style.top = `${top}px`;
        this.container.style.left = `${left}px`;
      }
    });

    // Focus src input
    requestAnimationFrame(() => {
      this.srcInput.focus();
      this.srcInput.select();
    });
  }

  private hide(): void {
    this.container.style.display = "none";
  }

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

  private handleRemove = () => {
    const { mediaNodePos } = useMediaPopupStore.getState();
    if (mediaNodePos < 0) return;

    const { state, dispatch } = this.editorView;
    const node = state.doc.nodeAt(mediaNodePos);
    if (!node) return;

    const tr = state.tr.delete(mediaNodePos, mediaNodePos + node.nodeSize);
    dispatch(tr);
    useMediaPopupStore.getState().closePopup();
  };

  private handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      useMediaPopupStore.getState().closePopup();
      this.editorView.focus();
    }
  };

  private handleOutsideClick = (e: MouseEvent) => {
    if (!useMediaPopupStore.getState().isOpen) return;
    if (this.container.contains(e.target as Node)) return;
    useMediaPopupStore.getState().closePopup();
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
    document.removeEventListener("mousedown", this.handleOutsideClick);
    this.container.remove();
  }
}
