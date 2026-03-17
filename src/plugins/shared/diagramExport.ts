/**
 * Diagram Export (shared)
 *
 * Creates a PNG export button with a light/dark theme picker menu.
 * Used by both mermaid and SVG export modules.
 *
 * The caller provides only the async `doExport(theme)` callback;
 * everything else (button, menu, positioning, event handling, cleanup)
 * is handled here.
 */

import i18n from "@/i18n";
import { registerCleanup } from "@/plugins/shared/diagramCleanup";

const EXPORT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#1e1e1e";

export interface ExportInstance {
  destroy(): void;
}

export type ExportTheme = "light" | "dark";

/**
 * Set up a PNG export button on a diagram container.
 *
 * @param container  The `.mermaid-preview` or `.svg-preview` wrapper element
 * @param doExport   Called when user picks a theme. Should perform the actual
 *                   render → PNG → save-dialog flow.
 */
export function setupDiagramExport(
  container: HTMLElement,
  doExport: (theme: ExportTheme) => Promise<void>,
): ExportInstance {
  const resetBtn = container.querySelector<HTMLElement>(".mermaid-panzoom-reset");

  const btn = document.createElement("button");
  btn.className = "mermaid-export-btn";
  const exportLabel = i18n.t("editor:plugin.exportPng");
  btn.title = exportLabel;
  btn.setAttribute("aria-label", exportLabel);
  btn.innerHTML = EXPORT_ICON_SVG;

  if (resetBtn) {
    container.insertBefore(btn, resetBtn);
  } else {
    container.appendChild(btn);
  }

  let menu: HTMLElement | null = null;

  function closeMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function showMenu() {
    if (menu) {
      closeMenu();
      return;
    }

    menu = document.createElement("div");
    menu.className = "mermaid-export-menu";

    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.right}px`;

    const lightItem = createMenuItem("Light", LIGHT_BG, () => {
      closeMenu();
      doExport("light");
    });
    const darkItem = createMenuItem("Dark", DARK_BG, () => {
      closeMenu();
      doExport("dark");
    });

    menu.appendChild(lightItem);
    menu.appendChild(darkItem);

    document.body.appendChild(menu);

    // Align right edge of menu with right edge of button
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${rect.right - menuRect.width}px`;
  }

  // Prevent ProseMirror and panzoom from processing button events
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu();
  });

  const onClickOutside = (e: MouseEvent) => {
    if (!menu) return;
    if (menu.contains(e.target as Node)) return;
    if (btn.contains(e.target as Node)) return;
    closeMenu();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && menu) {
      closeMenu();
    }
  };

  document.addEventListener("mousedown", onClickOutside);
  document.addEventListener("keydown", onKeyDown);

  function destroy() {
    closeMenu();
    btn.remove();
    document.removeEventListener("mousedown", onClickOutside);
    document.removeEventListener("keydown", onKeyDown);
  }

  // Auto-register cleanup so callers don't need to track destroy manually
  registerCleanup(container, destroy);

  return { destroy };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createMenuItem(
  label: string,
  swatchColor: string,
  onClick: () => void,
): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "mermaid-export-menu-item";

  const swatch = document.createElement("span");
  swatch.className = "mermaid-export-menu-swatch";
  swatch.style.background = swatchColor;

  const text = document.createElement("span");
  text.textContent = label;

  item.appendChild(swatch);
  item.appendChild(text);

  item.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  item.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return item;
}
