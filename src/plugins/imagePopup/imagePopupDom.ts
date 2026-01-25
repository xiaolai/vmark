// Shared DOM helpers for the image popup UI.

import { isImeKeyEvent } from "@/utils/imeGuard";
import { popupIcons } from "@/utils/popupComponents";

import type { ImageNodeType } from "@/stores/imagePopupStore";

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
  dimensionsSpan: HTMLElement;
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
  const browseBtn = buildIconButton(popupIcons.folder, "Browse local file", handlers.onBrowse);
  const copyBtn = buildIconButton(popupIcons.copy, "Copy path", handlers.onCopy);
  const toggleBtn = buildIconButton(popupIcons.blockImage, "Toggle block/inline", handlers.onToggle);
  toggleBtn.classList.add("image-popup-btn-toggle");
  const deleteBtn = buildIconButton(popupIcons.delete, "Remove image", handlers.onRemove);
  deleteBtn.classList.add("image-popup-btn-delete");

  srcRow.appendChild(srcInput);
  srcRow.appendChild(browseBtn);
  srcRow.appendChild(copyBtn);
  srcRow.appendChild(toggleBtn);
  srcRow.appendChild(deleteBtn);

  // Row 2: Caption/alt input + dimensions
  const altRow = document.createElement("div");
  altRow.className = "image-popup-row";

  const altInput = document.createElement("input");
  altInput.type = "text";
  altInput.className = "image-popup-alt";
  altInput.placeholder = "Caption (alt text)...";
  altInput.addEventListener("keydown", handlers.onInputKeydown);

  // Dimensions display (read-only)
  const dimensionsSpan = document.createElement("span");
  dimensionsSpan.className = "image-popup-dimensions";

  altRow.appendChild(altInput);
  altRow.appendChild(dimensionsSpan);

  container.appendChild(srcRow);
  container.appendChild(altRow);

  return { container, srcInput, altInput, toggleBtn, dimensionsSpan };
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
  const icon = nodeType === "block_image" ? popupIcons.inlineImage : popupIcons.blockImage;
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

export function installImagePopupKeyboardNavigation(
  container: HTMLElement,
  onClose?: () => void
): () => void {
  const keydownHandler = (e: KeyboardEvent) => {
    if (isImeKeyEvent(e)) return;

    const focusable = getFocusableElements(container);
    const activeEl = document.activeElement as HTMLElement;
    const isInsidePopup = container.contains(activeEl);

    // Handle ESC anywhere in the popup
    if (e.key === "Escape" && isInsidePopup) {
      e.preventDefault();
      onClose?.();
      return;
    }

    if (e.key !== "Tab") return;
    if (focusable.length === 0) return;

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
