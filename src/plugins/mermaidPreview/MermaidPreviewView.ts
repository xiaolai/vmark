/**
 * Mermaid Preview View
 *
 * Floating preview for mermaid diagram editing in Source mode.
 * Shows rendered diagram while user edits source.
 * Supports dragging, resizing, and zoom.
 */

import { renderMermaid } from "@/plugins/mermaid";
import { renderMarkmapToElement } from "@/plugins/markmap";
import { cleanupDescendants } from "@/plugins/shared/diagramCleanup";
import { renderSvgBlock } from "@/plugins/svg/svgRender";
import { sanitizeSvg } from "@/utils/sanitize";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";
import { getPopupHostForDom, toHostCoordsForDom } from "@/plugins/sourcePopup";

const PREVIEW_DEBOUNCE_MS = 200;
const ZOOM_STEP = 10;
const ZOOM_MIN = 10;
const ZOOM_MAX = 300;
const DEFAULT_ZOOM = 100;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

export class MermaidPreviewView {
  private container: HTMLElement;
  private header: HTMLElement;
  private zoomDisplay: HTMLElement;
  private preview: HTMLElement;
  private error: HTMLElement;
  private renderToken = 0;
  private visible = false;
  private editorDom: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentLanguage = "mermaid";

  // Zoom state
  private zoom = DEFAULT_ZOOM;

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartLeft = 0;
  private dragStartTop = 0;
  private hasDragged = false;

  // Resize state
  private isResizing = false;
  private resizeCorner: string | null = null;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeStartWidth = 0;
  private resizeStartHeight = 0;
  private resizeStartLeft = 0;
  private resizeStartTop = 0;

  // Store bound event handlers for cleanup
  private boundDragMove: ((e: MouseEvent) => void) | null = null;
  private boundDragUp: (() => void) | null = null;
  private boundResizeMove: ((e: MouseEvent) => void) | null = null;
  private boundResizeUp: (() => void) | null = null;

  constructor() {
    this.container = this.buildContainer();
    this.header = this.container.querySelector(".mermaid-preview-header") as HTMLElement;
    this.zoomDisplay = this.container.querySelector(".mermaid-preview-zoom-value") as HTMLElement;
    this.preview = this.container.querySelector(".mermaid-preview-content") as HTMLElement;
    this.error = this.container.querySelector(".mermaid-preview-error") as HTMLElement;

    this.setupDragHandlers();
    this.setupResizeHandlers();
    this.setupZoomHandlers();
  }

  private buildContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "mermaid-preview-popup";
    container.style.display = "none";

    // Header with drag handle and zoom controls
    const header = document.createElement("div");
    header.className = "mermaid-preview-header";

    const title = document.createElement("span");
    title.className = "mermaid-preview-title";
    title.textContent = "Preview";

    // Zoom controls: − 100% +
    const zoomControls = document.createElement("div");
    zoomControls.className = "mermaid-preview-zoom";

    const zoomOut = document.createElement("button");
    zoomOut.className = "mermaid-preview-zoom-btn";
    zoomOut.dataset.action = "out";
    zoomOut.title = "Zoom out";
    zoomOut.textContent = "−";

    const zoomValue = document.createElement("span");
    zoomValue.className = "mermaid-preview-zoom-value";
    zoomValue.textContent = "100%";

    const zoomIn = document.createElement("button");
    zoomIn.className = "mermaid-preview-zoom-btn";
    zoomIn.dataset.action = "in";
    zoomIn.title = "Zoom in";
    zoomIn.textContent = "+";

    zoomControls.appendChild(zoomOut);
    zoomControls.appendChild(zoomValue);
    zoomControls.appendChild(zoomIn);

    header.appendChild(title);
    header.appendChild(zoomControls);

    const preview = document.createElement("div");
    preview.className = "mermaid-preview-content";

    const error = document.createElement("div");
    error.className = "mermaid-preview-error";

    // Resize handles for corners and edges
    const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
    handles.forEach((pos) => {
      const handle = document.createElement("div");
      handle.className = `mermaid-preview-resize mermaid-preview-resize-${pos}`;
      handle.dataset.corner = pos;
      container.appendChild(handle);
    });

    container.appendChild(header);
    container.appendChild(preview);
    container.appendChild(error);

    return container;
  }

  private setupDragHandlers() {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't drag when clicking controls
      if (target.closest(".mermaid-preview-zoom")) return;

      this.isDragging = true;
      this.hasDragged = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartLeft = parseInt(this.container.style.left) || 0;
      this.dragStartTop = parseInt(this.container.style.top) || 0;
      this.container.classList.add("dragging");
      e.preventDefault();
    };

    // Store bound handlers for cleanup
    this.boundDragMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.container.style.left = `${this.dragStartLeft + dx}px`;
      this.container.style.top = `${this.dragStartTop + dy}px`;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.hasDragged = true;
      }
    };

    this.boundDragUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.container.classList.remove("dragging");
      }
    };

    this.header.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", this.boundDragMove);
    document.addEventListener("mouseup", this.boundDragUp);
  }

  private setupResizeHandlers() {
    const onMouseDown = (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest(".mermaid-preview-resize") as HTMLElement;
      if (!handle) return;

      this.isResizing = true;
      this.resizeCorner = handle.dataset.corner || "se";
      this.resizeStartX = e.clientX;
      this.resizeStartY = e.clientY;
      this.resizeStartWidth = this.container.offsetWidth;
      this.resizeStartHeight = this.container.offsetHeight;
      this.resizeStartLeft = parseInt(this.container.style.left) || 0;
      this.resizeStartTop = parseInt(this.container.style.top) || 0;
      this.container.classList.add("resizing");
      e.preventDefault();
      e.stopPropagation();
    };

    // Store bound handlers for cleanup
    this.boundResizeMove = (e: MouseEvent) => {
      if (!this.isResizing || !this.resizeCorner) return;

      const dx = e.clientX - this.resizeStartX;
      const dy = e.clientY - this.resizeStartY;

      let newWidth = this.resizeStartWidth;
      let newHeight = this.resizeStartHeight;
      let newLeft = this.resizeStartLeft;
      let newTop = this.resizeStartTop;

      // Handle horizontal resize based on corner
      if (this.resizeCorner.includes("e")) {
        newWidth = Math.max(MIN_WIDTH, this.resizeStartWidth + dx);
      } else if (this.resizeCorner.includes("w")) {
        const widthDelta = Math.min(dx, this.resizeStartWidth - MIN_WIDTH);
        newWidth = this.resizeStartWidth - widthDelta;
        newLeft = this.resizeStartLeft + widthDelta;
      }

      // Handle vertical resize based on corner
      if (this.resizeCorner.includes("s")) {
        newHeight = Math.max(MIN_HEIGHT, this.resizeStartHeight + dy);
      } else if (this.resizeCorner.includes("n")) {
        const heightDelta = Math.min(dy, this.resizeStartHeight - MIN_HEIGHT);
        newHeight = this.resizeStartHeight - heightDelta;
        newTop = this.resizeStartTop + heightDelta;
      }

      this.container.style.width = `${newWidth}px`;
      this.container.style.height = `${newHeight}px`;
      this.container.style.left = `${newLeft}px`;
      this.container.style.top = `${newTop}px`;
    };

    this.boundResizeUp = () => {
      if (this.isResizing) {
        this.isResizing = false;
        this.resizeCorner = null;
        this.container.classList.remove("resizing");
      }
    };

    this.container.querySelectorAll(".mermaid-preview-resize").forEach((handle) => {
      handle.addEventListener("mousedown", onMouseDown as EventListener);
    });
    document.addEventListener("mousemove", this.boundResizeMove);
    document.addEventListener("mouseup", this.boundResizeUp);
  }

  private setupZoomHandlers() {
    this.container.querySelector(".mermaid-preview-zoom")?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest(".mermaid-preview-zoom-btn") as HTMLElement;
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === "in" && this.zoom < ZOOM_MAX) {
        this.setZoom(Math.min(ZOOM_MAX, this.zoom + ZOOM_STEP));
      } else if (action === "out" && this.zoom > ZOOM_MIN) {
        this.setZoom(Math.max(ZOOM_MIN, this.zoom - ZOOM_STEP));
      }
    });

    // Cmd/Ctrl+scroll to zoom
    this.preview.addEventListener("wheel", (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom + delta));
        if (newZoom !== this.zoom) {
          this.setZoom(newZoom);
        }
      }
    }, { passive: false });
  }

  private setZoom(level: number) {
    this.zoom = level;
    this.zoomDisplay.textContent = `${level}%`;
    this.applyZoom();
  }

  private applyZoom() {
    const svg = this.preview.querySelector("svg");
    if (!svg) return;

    // Get original dimensions from SVG attributes or viewBox
    const viewBox = svg.getAttribute("viewBox");
    let originalWidth = parseFloat(svg.getAttribute("width") || "0");
    let originalHeight = parseFloat(svg.getAttribute("height") || "0");

    if (viewBox && (!originalWidth || !originalHeight)) {
      const parts = viewBox.split(/\s+/);
      if (parts.length === 4) {
        originalWidth = parseFloat(parts[2]);
        originalHeight = parseFloat(parts[3]);
      }
    }

    // Store original dimensions on first render
    if (!svg.dataset.originalWidth && originalWidth) {
      svg.dataset.originalWidth = String(originalWidth);
      svg.dataset.originalHeight = String(originalHeight);
    }

    const baseWidth = parseFloat(svg.dataset.originalWidth || String(originalWidth)) || 400;
    const baseHeight = parseFloat(svg.dataset.originalHeight || String(originalHeight)) || 300;

    // Apply zoom by setting dimensions directly (affects layout and centering)
    const scale = this.zoom / 100;
    svg.style.width = `${baseWidth * scale}px`;
    svg.style.height = `${baseHeight * scale}px`;
  }

  /** Check if preview position has been customized by dragging */
  hasCustomPosition() {
    return this.hasDragged;
  }

  show(content: string, anchorRect: AnchorRect, editorDom?: HTMLElement, language?: string) {
    this.currentLanguage = language ?? "mermaid";
    this.editorDom = editorDom ?? null;
    this.host = getPopupHostForDom(this.editorDom) ?? this.editorDom ?? document.body;
    if (this.container.parentElement !== this.host) {
      this.container.style.position = "absolute";
      this.host.appendChild(this.container);
    }
    this.container.style.display = "block";
    this.visible = true;

    this.updatePosition(anchorRect);
    this.renderPreview(content);
  }

  updatePosition(anchorRect: AnchorRect) {
    // Don't update position if user has dragged it
    if (this.hasDragged) return;

    const containerEl = this.editorDom?.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(this.editorDom as HTMLElement, containerEl)
      : getViewportBounds();

    const popupRect = this.container.getBoundingClientRect();
    const { top, left } = calculatePopupPosition({
      anchor: anchorRect,
      popup: {
        width: popupRect.width || 400,
        height: popupRect.height || 200,
      },
      bounds,
      gap: 8,
      preferAbove: false, // Prefer below for mermaid
    });

    const host = this.host ?? document.body;
    const hostPos = toHostCoordsForDom(host, { top, left });
    this.container.style.top = `${hostPos.top}px`;
    this.container.style.left = `${hostPos.left}px`;
  }

  updateContent(content: string, language?: string) {
    if (language) this.currentLanguage = language;

    // SVG rendering is synchronous — update immediately
    if (this.currentLanguage === "svg") {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.renderPreview(content);
      return;
    }

    // Debounce mermaid rendering
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.renderPreview(content);
    }, PREVIEW_DEBOUNCE_MS);
  }

  hide() {
    cleanupDescendants(this.preview);
    this.container.style.display = "none";
    this.visible = false;
    this.editorDom = null;
    this.host = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  isVisible() {
    return this.visible;
  }

  private renderPreview(content: string) {
    const trimmed = content.trim();
    this.error.textContent = "";
    this.preview.classList.remove("mermaid-preview-error-state");

    if (!trimmed) {
      this.preview.innerHTML = "";
      this.preview.classList.add("mermaid-preview-empty");
      return;
    }

    this.preview.classList.remove("mermaid-preview-empty");

    // SVG blocks: synchronous render, no loading state
    if (this.currentLanguage === "svg") {
      const rendered = renderSvgBlock(trimmed);
      if (rendered) {
        this.preview.innerHTML = sanitizeSvg(rendered);
        this.error.textContent = "";
        this.applyZoom();
      } else {
        this.preview.innerHTML = "";
        this.preview.classList.add("mermaid-preview-error-state");
        this.error.textContent = "Invalid SVG";
      }
      return;
    }

    // Markmap blocks: live SVG render
    if (this.currentLanguage === "markmap") {
      cleanupDescendants(this.preview);
      this.preview.innerHTML = "";
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgEl.style.width = "100%";
      svgEl.style.height = "100%";
      this.preview.appendChild(svgEl);

      const currentToken = ++this.renderToken;
      renderMarkmapToElement(svgEl, trimmed)
        .then((instance) => {
          if (currentToken !== this.renderToken) {
            // Stale render — next render's cleanupDescendants will handle it
            return;
          }
          if (!instance) {
            this.preview.innerHTML = "";
            this.preview.classList.add("mermaid-preview-error-state");
            this.error.textContent = "Invalid markmap syntax";
          } else {
            this.error.textContent = "";
          }
        })
        .catch(() => {
          if (currentToken !== this.renderToken) return;
          this.preview.innerHTML = "";
          this.preview.classList.add("mermaid-preview-error-state");
          this.error.textContent = "Preview failed";
        });
      return;
    }

    // Mermaid blocks: async render with loading state
    const currentToken = ++this.renderToken;
    this.preview.innerHTML = '<div class="mermaid-preview-loading">Rendering...</div>';

    renderMermaid(trimmed)
      .then((svg) => {
        if (currentToken !== this.renderToken) return;

        if (svg) {
          this.preview.innerHTML = sanitizeSvg(svg);
          this.error.textContent = "";
          this.applyZoom();
        } else {
          this.preview.innerHTML = "";
          this.preview.classList.add("mermaid-preview-error-state");
          this.error.textContent = "Invalid mermaid syntax";
        }
      })
      .catch(() => {
        if (currentToken !== this.renderToken) return;
        this.preview.innerHTML = "";
        this.preview.classList.add("mermaid-preview-error-state");
        this.error.textContent = "Preview failed";
      });
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Clean up document-level event listeners
    if (this.boundDragMove) {
      document.removeEventListener("mousemove", this.boundDragMove);
      this.boundDragMove = null;
    }
    if (this.boundDragUp) {
      document.removeEventListener("mouseup", this.boundDragUp);
      this.boundDragUp = null;
    }
    if (this.boundResizeMove) {
      document.removeEventListener("mousemove", this.boundResizeMove);
      this.boundResizeMove = null;
    }
    if (this.boundResizeUp) {
      document.removeEventListener("mouseup", this.boundResizeUp);
      this.boundResizeUp = null;
    }

    cleanupDescendants(this.preview);
    this.container.remove();
  }
}

// Singleton instance
let previewInstance: MermaidPreviewView | null = null;

export function getMermaidPreviewView(): MermaidPreviewView {
  if (!previewInstance) {
    previewInstance = new MermaidPreviewView();
  }
  return previewInstance;
}
