/**
 * Image Tooltip View
 *
 * Purpose: Read-only tooltip that appears on image hover showing filename, dimensions,
 * and a "Reveal in Finder" button. Distinct from the image popup (which allows editing).
 *
 * Key decisions:
 *   - Read-only by design — click the image to open the editing popup instead
 *   - Shows image metadata (filename, pixel dimensions) for quick reference
 *   - "Reveal in Finder" opens the file's location in the system file manager
 *   - Store-driven positioning via imageTooltipStore
 *
 * @coordinates-with tiptap.ts — hover detection and tooltip triggering
 * @coordinates-with stores/imageTooltipStore.ts — tooltip visibility and position state
 * @module plugins/imageTooltip/ImageTooltipView
 */

import { useImageTooltipStore } from "@/stores/imageTooltipStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

type EditorViewLike = {
  dom: HTMLElement;
  state: unknown;
  dispatch: (tr: unknown) => void;
  focus: () => void;
};

// SVG Icon for reveal in Finder
const revealIcon = `<svg viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

/**
 * Image tooltip view - manages the floating tooltip UI.
 */
export class ImageTooltipView {
  private container: HTMLElement;
  private filenameSpan: HTMLElement;
  private separatorSpan: HTMLElement;
  private dimensionsSpan: HTMLElement;
  private unsubscribe: () => void;
  private editorView: EditorViewLike;
  private host: HTMLElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(view: EditorViewLike) {
    this.editorView = view;

    // Build DOM structure
    this.container = this.buildContainer();
    this.filenameSpan = this.container.querySelector(".image-tooltip-filename") as HTMLElement;
    this.separatorSpan = this.container.querySelector(".image-tooltip-separator") as HTMLElement;
    this.dimensionsSpan = this.container.querySelector(".image-tooltip-dimensions") as HTMLElement;

    // Subscribe to store changes
    this.unsubscribe = useImageTooltipStore.subscribe((state) => {
      if (state.isOpen && state.anchorRect) {
        this.show(state.filename, state.dimensions, state.anchorRect);
      } else {
        this.hide();
      }
    });

    // Handle mouse leaving the tooltip
    this.container.addEventListener("mouseleave", this.handleMouseLeave);

    // Close tooltip on scroll
    this.editorView.dom
      .closest(".editor-container")
      ?.addEventListener("scroll", this.handleScroll, true);
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "image-tooltip";
    container.style.display = "none";

    // Filename display (read-only)
    const filenameSpan = document.createElement("span");
    filenameSpan.className = "image-tooltip-filename";
    container.appendChild(filenameSpan);

    // Separator dot
    const separatorSpan = document.createElement("span");
    separatorSpan.className = "image-tooltip-separator";
    separatorSpan.textContent = "·";
    container.appendChild(separatorSpan);

    // Dimensions display
    const dimensionsSpan = document.createElement("span");
    dimensionsSpan.className = "image-tooltip-dimensions";
    container.appendChild(dimensionsSpan);

    // Reveal button
    const revealBtn = document.createElement("button");
    revealBtn.className = "image-tooltip-btn";
    revealBtn.type = "button";
    revealBtn.title = "Reveal in Finder";
    revealBtn.innerHTML = revealIcon;
    revealBtn.addEventListener("click", this.handleReveal);
    container.appendChild(revealBtn);

    return container;
  }

  private show(
    filename: string,
    dimensions: { width: number; height: number } | null,
    anchorRect: AnchorRect
  ) {
    // Update content
    this.filenameSpan.textContent = this.truncateFilename(filename);
    this.filenameSpan.title = filename; // Full filename on hover

    if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
      this.dimensionsSpan.textContent = `${dimensions.width}×${dimensions.height}`;
      this.separatorSpan.style.display = "";
      this.dimensionsSpan.style.display = "";
    } else {
      this.separatorSpan.style.display = "none";
      this.dimensionsSpan.style.display = "none";
    }

    // Mount to editor container if available
    this.host = getPopupHostForDom(this.editorView.dom) ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = this.host === document.body ? "fixed" : "absolute";
      this.host.appendChild(this.container);
    }

    this.container.style.display = "flex";

    // Get boundaries
    const containerEl = this.editorView.dom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorView.dom as HTMLElement, containerEl)
      : getViewportBounds();

    // Calculate position
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width: 300, height: 30 },
      bounds,
      gap: 4,
      preferAbove: true,
    });

    // Convert to host-relative coordinates if needed
    if (this.host !== document.body) {
      const hostPos = toHostCoordsForDom(this.host, { top, left });
      this.container.style.top = `${hostPos.top}px`;
      this.container.style.left = `${hostPos.left}px`;
    } else {
      this.container.style.top = `${top}px`;
      this.container.style.left = `${left}px`;
    }

    // Set up Esc handler
    this.setupEscHandler();
  }

  private hide() {
    this.container.style.display = "none";
    this.host = null;
    this.removeEscHandler();
  }

  private truncateFilename(filename: string, maxLength = 30): string {
    if (filename.length <= maxLength) return filename;

    // Keep extension visible
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex > 0 && filename.length - dotIndex <= 10) {
      const ext = filename.slice(dotIndex);
      const name = filename.slice(0, dotIndex);
      const truncatedName = name.slice(0, maxLength - ext.length - 3);
      return `${truncatedName}...${ext}`;
    }

    return `${filename.slice(0, maxLength - 3)}...`;
  }

  private setupEscHandler() {
    if (this.escHandler) return;

    this.escHandler = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      if (e.key === "Escape") {
        useImageTooltipStore.getState().hideTooltip();
      }
    };
    document.addEventListener("keydown", this.escHandler);
  }

  private removeEscHandler() {
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler);
      this.escHandler = null;
    }
  }

  private handleReveal = async () => {
    const { imageSrc } = useImageTooltipStore.getState();
    if (!imageSrc) return;

    try {
      // Import Tauri APIs dynamically (platform-specific)
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      const { dirname, join } = await import("@tauri-apps/api/path");

      // Get document path to resolve relative paths
      const windowLabel = getWindowLabel();
      const activeTabId = useTabStore.getState().activeTabId[windowLabel];
      const doc = activeTabId ? useDocumentStore.getState().getDocument(activeTabId) : undefined;
      const filePath = doc?.filePath;

      if (!filePath) {
        console.warn("[ImageTooltip] No document path for reveal");
        useImageTooltipStore.getState().hideTooltip();
        return;
      }

      // Resolve relative path to absolute
      let absolutePath = imageSrc;
      if (!imageSrc.startsWith("/") && !imageSrc.startsWith("http")) {
        const docDir = await dirname(filePath);
        const cleanPath = imageSrc.replace(/^\.\//, "");
        absolutePath = await join(docDir, cleanPath);
      }

      await revealItemInDir(absolutePath);
    } catch (error) {
      console.error("[ImageTooltip] Reveal failed:", error);
    }

    useImageTooltipStore.getState().hideTooltip();
  };

  private handleMouseLeave = (e: MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // If moving back to an image in the editor, don't close immediately
    // The hover handler will take over
    if (relatedTarget?.closest("img.inline-image, .block-image img")) {
      return;
    }

    // Close the tooltip
    useImageTooltipStore.getState().hideTooltip();
  };

  private handleScroll = () => {
    const { isOpen } = useImageTooltipStore.getState();
    if (isOpen) {
      useImageTooltipStore.getState().hideTooltip();
    }
  };

  destroy() {
    this.unsubscribe();
    this.removeEscHandler();
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    this.editorView.dom
      .closest(".editor-container")
      ?.removeEventListener("scroll", this.handleScroll, true);
    this.container.remove();
  }
}
