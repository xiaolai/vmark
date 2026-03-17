/**
 * Mermaid Pan+Zoom
 *
 * Adds Cmd/Ctrl+scroll zoom and drag-to-pan to mermaid diagram containers
 * in WYSIWYG mode. Uses @panzoom/panzoom on the SVG element directly
 * (CSS transforms), with noBind to coexist with double-click-to-edit.
 * Plain scroll passes through to the document.
 */

import i18n from "@/i18n";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { registerCleanup } from "@/plugins/shared/diagramCleanup";

export interface MermaidPanZoomInstance {
  reset(): void;
  destroy(): void;
}

const RESET_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

export function setupMermaidPanZoom(
  container: HTMLElement,
  options?: { showResetButton?: boolean }
): MermaidPanZoomInstance | null {
  if (container.classList.contains("panzoom-enabled")) return null;

  const svg = container.querySelector<SVGSVGElement>("svg");
  if (!svg) return null;

  const showReset = options?.showResetButton ?? true;

  // Use inline styles to avoid CSS specificity fights with
  // .code-block-preview.mermaid-preview { overflow: auto }
  const prevOverflow = container.style.overflow;
  const prevPosition = container.style.position;
  container.style.overflow = "hidden";
  container.style.position = "relative";
  container.classList.add("panzoom-enabled");

  // Apply panzoom directly to the SVG element (CSS transform).
  // This scales the entire SVG as a visual block within the container.
  const pz: PanzoomObject = Panzoom(svg as unknown as HTMLElement, {
    startScale: 1,
    minScale: 0.5,
    maxScale: 5,
    cursor: "default",
    noBind: true,
  });

  // --- Wheel: Cmd/Ctrl+scroll = zoom, plain scroll passes through ---
  const onWheel = (e: WheelEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      pz.zoomWithWheel(e, { animate: false });
    }
  };
  container.addEventListener("wheel", onWheel, { passive: false });

  // --- Pointer events for drag-to-pan ---
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest(".mermaid-panzoom-reset, .mermaid-export-btn")) return;
    pz.handleDown(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    pz.handleMove(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    pz.handleUp(e);
  };

  container.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);

  // --- Reset button ---
  let resetBtn: HTMLButtonElement | null = null;
  if (showReset) {
    resetBtn = document.createElement("button");
    resetBtn.className = "mermaid-panzoom-reset";
    const resetLabel = i18n.t("editor:plugin.resetZoom");
    resetBtn.title = resetLabel;
    resetBtn.setAttribute("aria-label", resetLabel);
    resetBtn.innerHTML = RESET_ICON_SVG;
    resetBtn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pz.reset({ animate: true });
    });
    container.appendChild(resetBtn);
  }

  const reset = () => {
    pz.reset({ animate: true });
  };

  const destroy = () => {
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    pz.destroy();

    if (resetBtn) {
      resetBtn.remove();
      resetBtn = null;
    }

    container.classList.remove("panzoom-enabled");
    container.style.overflow = prevOverflow;
    container.style.position = prevPosition;
  };

  // Auto-register cleanup so callers don't need to track destroy manually
  registerCleanup(container, destroy);

  return { reset, destroy };
}
