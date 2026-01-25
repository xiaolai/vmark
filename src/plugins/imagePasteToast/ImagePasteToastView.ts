/**
 * Image Paste Toast View
 *
 * DOM management for the image paste confirmation toast.
 * Shows when pasting text that looks like an image URL/path,
 * allowing user to choose between inserting as image or text.
 */

import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { popupIcons } from "@/utils/popupComponents";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const AUTO_DISMISS_MS = 5000;

/**
 * Image paste toast view - manages the floating toast UI.
 */
export class ImagePasteToastView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private autoDismissTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private host: HTMLElement | null = null;

  constructor() {
    // Build DOM structure
    this.container = this.buildContainer();

    // Container will be appended to host in show()

    // Subscribe to store changes
    this.unsubscribe = useImagePasteToastStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        this.show(
          state.imagePath,
          state.imageType,
          state.anchorRect,
          state.editorDom,
          state.isMultiple,
          state.imageCount
        );
      } else {
        this.hide();
      }
    });

    // Handle click outside
    document.addEventListener("mousedown", this.handleClickOutside);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "image-paste-toast";
    container.style.display = "none";

    // Message
    const messageEl = document.createElement("span");
    messageEl.className = "image-paste-toast-message";
    messageEl.textContent = "Image detected";

    // Icon buttons (matching link popup style)
    // Insert button (check mark)
    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className = "image-paste-toast-btn image-paste-toast-btn-insert";
    insertBtn.title = "Insert as Image";
    insertBtn.innerHTML = popupIcons.save;
    insertBtn.addEventListener("click", this.handleInsert);

    // Dismiss button (X mark)
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "image-paste-toast-btn image-paste-toast-btn-dismiss";
    dismissBtn.title = "Paste as Text";
    dismissBtn.innerHTML = popupIcons.type;
    dismissBtn.addEventListener("click", this.handleDismiss);

    container.appendChild(messageEl);
    container.appendChild(insertBtn);
    container.appendChild(dismissBtn);

    return container;
  }

  private show(
    _imagePath: string,
    imageType: "url" | "localPath",
    anchorRect: AnchorRect,
    editorDom: HTMLElement | null,
    isMultiple: boolean = false,
    imageCount: number = 1
  ) {
    // Update message based on type and count
    const messageEl = this.container.querySelector(".image-paste-toast-message");
    if (messageEl) {
      if (isMultiple && imageCount > 1) {
        messageEl.textContent = `${imageCount} images`;
      } else {
        messageEl.textContent = imageType === "url" ? "Image URL" : "Image path";
      }
    }

    // Update button titles for multiple images
    const insertBtn = this.container.querySelector(".image-paste-toast-btn-insert") as HTMLButtonElement;
    if (insertBtn) {
      insertBtn.title = isMultiple && imageCount > 1 ? "Insert All" : "Insert as Image";
    }

    // Mount to editor container if available, otherwise document.body
    this.host = getPopupHostForDom(editorDom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    // Calculate bounds from editor container (like link popup)
    let bounds = getViewportBounds();
    if (editorDom) {
      const containerEl = editorDom.closest(".editor-container") as HTMLElement;
      if (containerEl) {
        // For CodeMirror (source mode), use .cm-content for horizontal bounds
        // because it has padding (0 2em) while .cm-editor spans full width
        const cmContent = editorDom.querySelector(".cm-content") as HTMLElement;
        const horizontalEl = cmContent || editorDom;
        bounds = getBoundaryRects(horizontalEl, containerEl);
      }
    }

    // Calculate position (compact size with icon buttons)
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 160, height: 36 },
      bounds,
      gap: 6,
      preferAbove: true,
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

    // Set up keyboard handling
    this.setupKeyboardHandler();

    // Start auto-dismiss timer
    this.startAutoDismissTimer();

    // Focus the insert button
    requestAnimationFrame(() => {
      const insertBtn = this.container.querySelector(".image-paste-toast-btn-insert") as HTMLButtonElement;
      if (insertBtn) {
        insertBtn.focus();
      }
    });
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
    this.clearAutoDismissTimer();
    this.removeKeyboardHandler();
  }

  private setupKeyboardHandler() {
    this.keydownHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;

      const { isOpen } = useImagePasteToastStore.getState();
      if (!isOpen) return;

      if (e.key === "Enter") {
        e.preventDefault();
        // Activate the currently focused button
        const activeEl = document.activeElement as HTMLElement;
        if (activeEl?.classList.contains("image-paste-toast-btn-insert")) {
          this.handleInsert();
        } else if (activeEl?.classList.contains("image-paste-toast-btn-dismiss")) {
          this.handleDismiss();
        } else {
          // No button focused, default to insert
          this.handleInsert();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Escape closes without any action (no paste)
        useImagePasteToastStore.getState().hideToast();
      } else if (e.key === "Tab") {
        // Trap focus within toast
        e.preventDefault();
        const buttons = this.container.querySelectorAll<HTMLButtonElement>(".image-paste-toast-btn");
        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = Array.from(buttons).indexOf(activeEl as HTMLButtonElement);
        const nextIndex = e.shiftKey
          ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
          : (currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1);
        buttons[nextIndex].focus();
      }
    };

    document.addEventListener("keydown", this.keydownHandler);
  }

  private removeKeyboardHandler() {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private startAutoDismissTimer() {
    this.clearAutoDismissTimer();
    this.autoDismissTimer = window.setTimeout(() => {
      // Auto-dismiss = close without any action (user ignored it)
      useImagePasteToastStore.getState().hideToast();
    }, AUTO_DISMISS_MS);
  }

  private clearAutoDismissTimer() {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  private handleInsert = () => {
    useImagePasteToastStore.getState().confirm();
  };

  private handleDismiss = () => {
    useImagePasteToastStore.getState().dismiss();
  };

  private handleClickOutside = (e: MouseEvent) => {
    const { isOpen } = useImagePasteToastStore.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      // Click outside = close without any action (no paste)
      useImagePasteToastStore.getState().hideToast();
    }
  };

  destroy() {
    this.unsubscribe();
    this.clearAutoDismissTimer();
    this.removeKeyboardHandler();
    document.removeEventListener("mousedown", this.handleClickOutside);
    this.container.remove();
  }
}

// Singleton instance
let instance: ImagePasteToastView | null = null;

/**
 * Initialize the image paste toast view (call once at app startup).
 */
export function initImagePasteToast(): void {
  if (!instance) {
    instance = new ImagePasteToastView();
  }
}

/**
 * Destroy the image paste toast view.
 */
export function destroyImagePasteToast(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
