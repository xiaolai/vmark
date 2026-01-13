/**
 * Image Popup View
 *
 * DOM management for the image editing popup.
 * Shows when clicking on an image, allows editing src/browsing/copying/removing.
 */

import type { EditorView } from "@tiptap/pm/view";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { createImagePopupDom, installImagePopupKeyboardNavigation, updateImagePopupToggleButton } from "./imagePopupDom";
import { browseAndReplaceImage } from "./imagePopupActions";
import { isImeKeyEvent } from "@/utils/imeGuard";

/**
 * Image popup view - manages the floating popup UI.
 */
export class ImagePopupView {
  private container: HTMLElement;
  private srcInput: HTMLInputElement;
  private altInput: HTMLInputElement;
  private toggleBtn: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorView;
  private justOpened = false;
  private wasOpen = false;
  private removeKeyboardNavigation: (() => void) | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    const dom = createImagePopupDom({
      onBrowse: this.handleBrowse,
      onCopy: this.handleCopy,
      onToggle: this.handleToggle,
      onRemove: this.handleRemove,
      onInputKeydown: this.handleInputKeydown,
    });
    this.container = dom.container;
    this.srcInput = dom.srcInput;
    this.altInput = dom.altInput;
    this.toggleBtn = dom.toggleBtn;

    // Append to document body (avoids interfering with editor DOM)
    document.body.appendChild(this.container);

    // Subscribe to store changes - only show() on open transition
    this.unsubscribe = useImagePopupStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        // Only call show() when transitioning from closed to open
        if (!this.wasOpen) {
          this.show(state.imageSrc, state.imageAlt, state.anchorRect);
        }
        this.wasOpen = true;
      } else {
        this.hide();
        this.wasOpen = false;
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);
  }

  private show(imageSrc: string, imageAlt: string, anchorRect: AnchorRect) {
    const { imageNodeType } = useImagePopupStore.getState();
    this.srcInput.value = imageSrc;
    this.altInput.value = imageAlt;
    this.container.style.display = "flex";
    this.container.style.position = "fixed";

    // Update toggle button icon based on current type
    updateImagePopupToggleButton(this.toggleBtn, imageNodeType);

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

    // Calculate position using utility (taller now with 2 rows)
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 340, height: 72 },
      bounds,
      gap: 6,
      preferAbove: true, // Image popup appears above the image
    });

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;

    // Set up keyboard navigation
    if (this.removeKeyboardNavigation) {
      this.removeKeyboardNavigation();
    }
    this.removeKeyboardNavigation = installImagePopupKeyboardNavigation(this.container);

    // Focus src input
    requestAnimationFrame(() => {
      this.srcInput.focus();
      this.srcInput.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
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
      useImagePopupStore.getState().closePopup();
      this.editorView.focus();
    }
  };

  private handleSave = () => {
    const state = useImagePopupStore.getState();
    const { imageNodePos } = state;
    const newSrc = this.srcInput.value.trim();
    const newAlt = this.altInput.value.trim();

    if (!newSrc) {
      // Empty src - remove the image
      this.handleRemove();
      return;
    }

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(imageNodePos);
      if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) return;

      // Update image src and alt
      const tr = editorState.tr.setNodeMarkup(imageNodePos, null, {
        ...node.attrs,
        src: newSrc,
        alt: newAlt,
      });

      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[ImagePopup] Save failed:", error);
      state.closePopup();
    }
  };

  private handleToggle = () => {
    const state = useImagePopupStore.getState();
    const { imageNodePos, imageNodeType } = state;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(imageNodePos);
      if (!node) return;

      const attrs = { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title };

      if (imageNodeType === "block_image") {
        // Block → Inline: Replace with inline image
        const inlineImageType = editorState.schema.nodes.image;
        if (!inlineImageType) {
          console.warn("[ImagePopup] inline image schema not available");
          return;
        }

        const inlineNode = inlineImageType.create(attrs);
        const tr = editorState.tr.replaceWith(
          imageNodePos,
          imageNodePos + node.nodeSize,
          inlineNode
        );
        dispatch(tr);

        // Update store state and close popup (conversion complete)
        useImagePopupStore.getState().setNodeType("image");
        useImagePopupStore.getState().closePopup();
      } else {
        // Inline → Block: Replace with block image
        const blockImageType = editorState.schema.nodes.block_image;
        if (!blockImageType) {
          console.warn("[ImagePopup] block_image schema not available");
          return;
        }

        const blockNode = blockImageType.create(attrs);
        const tr = editorState.tr.replaceWith(
          imageNodePos,
          imageNodePos + node.nodeSize,
          blockNode
        );
        dispatch(tr);

        // Update store state and close popup (conversion complete)
        useImagePopupStore.getState().setNodeType("block_image");
        useImagePopupStore.getState().closePopup();
      }
    } catch (error) {
      console.error("[ImagePopup] Toggle failed:", error);
    }
  };

  private handleBrowse = async () => {
    const state = useImagePopupStore.getState();
    const updated = await browseAndReplaceImage(this.editorView, state.imageNodePos);
    if (updated) {
      state.closePopup();
      this.editorView.focus();
    }
  };

  private handleCopy = async () => {
    const { imageSrc } = useImagePopupStore.getState();
    if (imageSrc) {
      try {
        await navigator.clipboard.writeText(imageSrc);
      } catch (err) {
        console.error("Failed to copy image path:", err);
      }
    }
    useImagePopupStore.getState().closePopup();
    this.editorView.focus();
  };

  private handleRemove = () => {
    const state = useImagePopupStore.getState();
    const { imageNodePos } = state;

    try {
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) return;

      const node = editorState.doc.nodeAt(imageNodePos);
      if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) return;

      // Delete the node
      const tr = editorState.tr.delete(imageNodePos, imageNodePos + node.nodeSize);
      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[ImagePopup] Remove failed:", error);
      state.closePopup();
    }
  };

  private handleClickOutside = (e: MouseEvent) => {
    // Guard against race condition where same click opens and closes popup
    if (this.justOpened) return;

    const { isOpen } = useImagePopupStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      useImagePopupStore.getState().closePopup();
    }
  };

  destroy() {
    this.unsubscribe();
    if (this.removeKeyboardNavigation) {
      this.removeKeyboardNavigation();
      this.removeKeyboardNavigation = null;
    }
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
