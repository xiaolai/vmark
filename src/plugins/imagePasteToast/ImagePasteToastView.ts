/**
 * Image Paste Toast View
 *
 * Purpose: Shows a transient confirmation toast when pasting text that looks like an
 * image URL/path, letting the user choose between inserting as image or as plain text.
 *
 * Key decisions:
 *   - Auto-dismisses after 5 seconds if the user doesn't interact
 *   - Positioned relative to the cursor using the popup positioning system
 *   - DOM-based (not React) for consistency with other editor popups
 *   - Escape key dismisses the toast
 *   - Reads state through a PORT it declares, never the app's store (ADR-015)
 *   - Buttons come from `buildPopupIconButton` on the canonical
 *     `.popup-icon-btn` surface (WI-DP4.1). `.image-paste-toast-btn` was not
 *     only styling — the Tab focus trap enumerated its buttons by it — so the
 *     trap now selects `.popup-icon-btn`, scoped to this container.
 *
 * @coordinates-with imagePasteToast/types.ts — the state PORT the host satisfies
 * @coordinates-with imageHandler/tiptap.ts — triggers the toast on ambiguous image pastes
 * @module plugins/imagePasteToast/ImagePasteToastView
 */

import type { ImagePasteToastStore } from "./types";
import i18n from "@/i18n";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { buildPopupIconButton } from "@/utils/popupComponents";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/shared/popupHostDom";

const AUTO_DISMISS_MS = 5000;

/**
 * Image paste toast view - manages the floating toast UI.
 */
class ImagePasteToastView {
  private container: HTMLElement;
  private unsubscribe: () => void;
  private autoDismissTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private host: HTMLElement | null = null;

  constructor(private store: ImagePasteToastStore) {
    // Build DOM structure
    this.container = this.buildContainer();

    // Container will be appended to host in show()

    // Subscribe to store changes
    this.unsubscribe = this.store.subscribe((state) => {
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
    container.className = "popup-container image-paste-toast";
    container.style.display = "none";

    // Message
    const messageEl = document.createElement("span");
    messageEl.className = "image-paste-toast-message";
    messageEl.textContent = i18n.t("editor:plugin.imageDetected");

    const insertBtn = buildPopupIconButton({
      icon: "save",
      title: i18n.t("editor:plugin.insertAsImage"),
      onClick: this.handleInsert,
      className: "image-paste-toast-btn-insert",
    });
    const dismissBtn = buildPopupIconButton({
      icon: "type",
      title: i18n.t("editor:plugin.pasteAsText"),
      onClick: this.handleDismiss,
      className: "image-paste-toast-btn-dismiss",
    });

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
    /* v8 ignore next -- @preserve defensive guard: messageEl is always present (created in buildContainer) */
    if (messageEl) {
      if (isMultiple && imageCount > 1) {
        messageEl.textContent = `${imageCount} images`;
      } else {
        messageEl.textContent = imageType === "url" ? "Image URL" : "Image path";
      }
    }

    // Update button titles for multiple images
    const insertBtn = this.container.querySelector(".image-paste-toast-btn-insert") as HTMLButtonElement;
    /* v8 ignore next -- @preserve defensive guard: insertBtn is always present (created in buildContainer) */
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
      const containerEl = editorDom.closest(".editor-container") as HTMLElement | null;
      if (containerEl) {
        // For CodeMirror (source mode), use .cm-content for horizontal bounds
        // because it has padding (0 2em) while .cm-editor spans full width
        const cmContent = editorDom.querySelector(".cm-content") as HTMLElement | null;
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
      /* v8 ignore next -- @preserve defensive guard: insertBtn is always present (created in buildContainer) */
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

      const { isOpen } = this.store.getState();
      /* v8 ignore next -- @preserve defensive guard: handler is removed in hide() before isOpen becomes false */
      if (!isOpen) return;

      if (e.key === "Enter") {
        e.preventDefault();
        // Activate the currently focused button
        const activeEl = document.activeElement as HTMLElement;
        /* v8 ignore start -- @preserve reason: activeElement class checks depend on real DOM focus; jsdom doesn't track button focus in NodeView */
        if (activeEl?.classList.contains("image-paste-toast-btn-insert")) {
          this.handleInsert();
        } else if (activeEl?.classList.contains("image-paste-toast-btn-dismiss")) {
          this.handleDismiss();
        } else {
          this.handleInsert();
        }
        /* v8 ignore stop */
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Escape closes without any action (no paste)
        this.store.getState().hideToast();
      } else if (e.key === "Tab") {
        // Trap focus within toast
        e.preventDefault();
        // WI-DP4.1: canonical class, container-scoped (see the header).
        const buttons = this.container.querySelectorAll<HTMLButtonElement>(".popup-icon-btn");
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
      this.store.getState().hideToast();
    }, AUTO_DISMISS_MS);
  }

  private clearAutoDismissTimer() {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  private handleInsert = () => {
    this.store.getState().confirm();
  };

  private handleDismiss = () => {
    this.store.getState().dismiss();
  };

  private handleClickOutside = (e: MouseEvent) => {
    const { isOpen } = this.store.getState();
    if (!isOpen) return;

    const target = e.target as Node;
    if (!this.container.contains(target)) {
      // Click outside = close without any action (no paste)
      this.store.getState().hideToast();
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
export function initImagePasteToast(store: ImagePasteToastStore): void {
  if (!instance) {
    instance = new ImagePasteToastView(store);
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
