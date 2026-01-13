// Shared DOM helpers for the image popup UI.

import { isImeKeyEvent } from "@/utils/imeGuard";

import type { ImageNodeType } from "@/stores/imagePopupStore";

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

interface ImagePopupDomHandlers {
  onBrowse: () => void;
  onCopy: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onInputKeydown: (e: KeyboardEvent) => void;
}

export interface ImagePopupDom {
  container: HTMLElement;
  srcInput: HTMLInputElement;
  altInput: HTMLInputElement;
  toggleBtn: HTMLElement;
}

export function createImagePopupDom(handlers: ImagePopupDomHandlers): ImagePopupDom {
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
  srcInput.addEventListener("keydown", handlers.onInputKeydown);

  // Icon buttons: browse, copy, toggle, delete
  const browseBtn = buildIconButton(icons.folder, "Browse local file", handlers.onBrowse);
  const copyBtn = buildIconButton(icons.copy, "Copy path", handlers.onCopy);
  const toggleBtn = buildIconButton(icons.blockImage, "Toggle block/inline", handlers.onToggle);
  toggleBtn.classList.add("image-popup-btn-toggle");
  const deleteBtn = buildIconButton(icons.delete, "Remove image", handlers.onRemove);
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
  altInput.addEventListener("keydown", handlers.onInputKeydown);

  altRow.appendChild(altInput);

  container.appendChild(srcRow);
  container.appendChild(altRow);

  return { container, srcInput, altInput, toggleBtn };
}

function buildIconButton(iconSvg: string, title: string, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "image-popup-btn";
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = iconSvg;
  btn.addEventListener("click", onClick);
  return btn;
}

export function updateImagePopupToggleButton(toggleBtn: HTMLElement, nodeType: ImageNodeType) {
  const icon = nodeType === "block_image" ? icons.inlineImage : icons.blockImage;
  const title = nodeType === "block_image" ? "Convert to inline" : "Convert to block";
  toggleBtn.innerHTML = icon;
  toggleBtn.title = title;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function installImagePopupKeyboardNavigation(container: HTMLElement): () => void {
  const keydownHandler = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;
    if (e.key !== "Tab") return;

    const focusable = getFocusableElements(container);
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
  };

  document.addEventListener("keydown", keydownHandler);
  return () => document.removeEventListener("keydown", keydownHandler);
}
