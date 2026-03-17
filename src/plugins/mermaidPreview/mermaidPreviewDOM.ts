/**
 * Mermaid Preview DOM Builder
 *
 * Constructs the popup container DOM for mermaid/SVG/markmap preview.
 * Pure DOM creation -- no state, no event handlers.
 */

import i18n from "@/i18n";

/** Build the preview popup container with header, content, error, and resize handles. */
export function buildContainer(): HTMLElement {
  const container = document.createElement("div");
  container.className = "mermaid-preview-popup";
  container.style.display = "none";

  // Header with drag handle and zoom controls
  const header = document.createElement("div");
  header.className = "mermaid-preview-header";

  const title = document.createElement("span");
  title.className = "mermaid-preview-title";
  title.textContent = "Preview";

  // Zoom controls: - 100% +
  const zoomControls = document.createElement("div");
  zoomControls.className = "mermaid-preview-zoom";

  const zoomOut = document.createElement("button");
  zoomOut.className = "mermaid-preview-zoom-btn";
  zoomOut.dataset.action = "out";
  const zoomOutLabel = i18n.t("editor:plugin.zoomOut");
  zoomOut.title = zoomOutLabel;
  zoomOut.setAttribute("aria-label", zoomOutLabel);
  zoomOut.textContent = "\u2212";

  const zoomValue = document.createElement("span");
  zoomValue.className = "mermaid-preview-zoom-value";
  zoomValue.textContent = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.className = "mermaid-preview-zoom-btn";
  zoomIn.dataset.action = "in";
  const zoomInLabel = i18n.t("editor:plugin.zoomIn");
  zoomIn.title = zoomInLabel;
  zoomIn.setAttribute("aria-label", zoomInLabel);
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
