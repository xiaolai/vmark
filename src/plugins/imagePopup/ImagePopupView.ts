/**
 * Image Popup View
 *
 * DOM management for the image editing popup.
 * Shows when clicking on an image, allows editing src/browsing/copying/removing.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { open, message } from "@tauri-apps/plugin-dialog";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getWindowLabel } from "@/utils/windowFocus";
import { copyImageToAssets } from "@/utils/imageUtils";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";

// SVG Icons (matching project style)
const icons = {
  folder: `<svg viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  // Block image icon (image with frame)
  blockImage: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  // Inline image icon (image with text line)
  inlineImage: `<svg viewBox="0 0 24 24"><rect x="2" y="6" width="10" height="10" rx="1"/><circle cx="5" cy="9" r="1.5"/><path d="m12 13-2-2-3 5"/><line x1="16" y1="8" x2="22" y2="8"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="16" y1="16" x2="22" y2="16"/></svg>`,
};

// Re-entry guard for browse action
let isBrowsing = false;

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
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorView) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer();
    this.srcInput = this.container.querySelector(
      ".image-popup-src"
    ) as HTMLInputElement;
    this.altInput = this.container.querySelector(
      ".image-popup-alt"
    ) as HTMLInputElement;
    this.toggleBtn = this.container.querySelector(
      ".image-popup-btn-toggle"
    ) as HTMLElement;

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

  private getFocusableElements(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  private setupKeyboardNavigation() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusable = this.getFocusableElements();
        if (focusable.length === 0) return;

        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = focusable.indexOf(activeEl);

        // Only handle Tab if focus is inside the popup
        if (currentIndex === -1) return;

        e.preventDefault();

        if (e.shiftKey) {
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      }
    };

    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardNavigation() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "image-popup";
    container.style.display = "none";

    // Row 1: Source input + buttons
    const srcRow = document.createElement("div");
    srcRow.className = "image-popup-row";

    const srcInput = document.createElement("input");
    srcInput.type = "text";
    srcInput.className = "image-popup-src";
    srcInput.placeholder = "Image URL or path...";
    srcInput.addEventListener("keydown", this.handleInputKeydown);

    // Icon buttons: browse, copy, toggle, delete
    const browseBtn = this.buildIconButton(
      icons.folder,
      "Browse local file",
      this.handleBrowse
    );
    const copyBtn = this.buildIconButton(
      icons.copy,
      "Copy path",
      this.handleCopy
    );
    const toggleBtn = this.buildIconButton(
      icons.blockImage,
      "Toggle block/inline",
      this.handleToggle
    );
    toggleBtn.classList.add("image-popup-btn-toggle");
    const deleteBtn = this.buildIconButton(
      icons.delete,
      "Remove image",
      this.handleRemove
    );
    deleteBtn.classList.add("image-popup-btn-delete");

    srcRow.appendChild(srcInput);
    srcRow.appendChild(browseBtn);
    srcRow.appendChild(copyBtn);
    srcRow.appendChild(toggleBtn);
    srcRow.appendChild(deleteBtn);

    // Row 2: Caption/alt input
    const altRow = document.createElement("div");
    altRow.className = "image-popup-row";

    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.className = "image-popup-alt";
    altInput.placeholder = "Caption (alt text)...";
    altInput.addEventListener("keydown", this.handleInputKeydown);

    altRow.appendChild(altInput);

    container.appendChild(srcRow);
    container.appendChild(altRow);

    return container;
  }

  private buildIconButton(
    iconSvg: string,
    title: string,
    onClick: () => void
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "image-popup-btn";
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private show(imageSrc: string, imageAlt: string, anchorRect: AnchorRect) {
    const { imageNodeType } = useImagePopupStore.getState();
    this.srcInput.value = imageSrc;
    this.altInput.value = imageAlt;
    this.container.style.display = "flex";
    this.container.style.position = "fixed";

    // Update toggle button icon based on current type
    this.updateToggleIcon(imageNodeType);

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
    this.setupKeyboardNavigation();

    // Focus src input
    requestAnimationFrame(() => {
      this.srcInput.focus();
      this.srcInput.select();
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.removeKeyboardNavigation();
  }

  private updateToggleIcon(nodeType: "image" | "block_image") {
    // Show inline icon when currently block (clicking will make it inline)
    // Show block icon when currently inline (clicking will make it block)
    const icon = nodeType === "block_image" ? icons.inlineImage : icons.blockImage;
    const title = nodeType === "block_image" ? "Convert to inline" : "Convert to block";
    this.toggleBtn.innerHTML = icon;
    this.toggleBtn.title = title;
  }

  private handleInputKeydown = (e: KeyboardEvent) => {
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
    if (isBrowsing) return;
    isBrowsing = true;

    const state = useImagePopupStore.getState();
    const { imageNodePos } = state;

    try {
      const sourcePath = await open({
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      });

      if (!sourcePath) {
        isBrowsing = false;
        return;
      }

      const windowLabel = getWindowLabel();
      const doc = useDocumentStore.getState().getDocument(windowLabel);
      const filePath = doc?.filePath;

      if (!filePath) {
        await message("Please save the document first to use local images.", {
          title: "Unsaved Document",
          kind: "warning",
        });
        isBrowsing = false;
        return;
      }

      // Copy new image to assets folder
      const relativePath = await copyImageToAssets(
        sourcePath as string,
        filePath
      );

      // Update the image node with new src
      const { state: editorState, dispatch } = this.editorView;
      if (!editorState) {
        isBrowsing = false;
        return;
      }

      const node = editorState.doc.nodeAt(imageNodePos);
      if (!node || (node.type.name !== "image" && node.type.name !== "block_image")) {
        isBrowsing = false;
        return;
      }

      const tr = editorState.tr.setNodeMarkup(imageNodePos, null, {
        ...node.attrs,
        src: relativePath,
      });

      dispatch(tr);
      state.closePopup();
      this.editorView.focus();
    } catch (error) {
      console.error("[ImagePopup] Browse failed:", error);
      await message("Failed to change image.", { kind: "error" });
    } finally {
      isBrowsing = false;
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
    this.removeKeyboardNavigation();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}
