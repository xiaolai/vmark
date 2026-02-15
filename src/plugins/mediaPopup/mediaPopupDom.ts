/**
 * Media Popup DOM Helpers
 *
 * Purpose: Shared DOM construction and keyboard navigation for the media popup UI.
 * Extracted from MediaPopupView to keep the view class focused on behavior.
 *
 * @coordinates-with MediaPopupView.ts — consumes these helpers for popup DOM construction
 * @coordinates-with utils/popupComponents.ts — shared popup icon buttons and inputs
 * @module plugins/mediaPopup/mediaPopupDom
 */

import { isImeKeyEvent } from "@/utils/imeGuard";
import { buildPopupIconButton, buildPopupInput } from "@/utils/popupComponents";

interface MediaPopupDomHandlers {
  onBrowse: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onInputKeydown: (e: KeyboardEvent) => void;
}

export interface MediaPopupDom {
  container: HTMLElement;
  srcInput: HTMLInputElement;
  titleInput: HTMLInputElement;
  posterInput: HTMLInputElement;
  posterRow: HTMLElement;
}

export function createMediaPopupDom(handlers: MediaPopupDomHandlers): MediaPopupDom {
  const container = document.createElement("div");
  container.className = "media-popup";
  container.style.display = "none";

  // Row 1: Source input + action buttons
  const srcRow = document.createElement("div");
  srcRow.className = "media-popup-row";

  const srcInput = buildPopupInput({
    placeholder: "Media source path or URL...",
    monospace: true,
    className: "media-popup-src",
    onKeydown: handlers.onInputKeydown,
  });

  const browseBtn = buildPopupIconButton({
    icon: "folder",
    title: "Browse local file",
    onClick: handlers.onBrowse,
  });
  browseBtn.classList.add("media-popup-btn");

  const copyBtn = buildPopupIconButton({
    icon: "copy",
    title: "Copy path",
    onClick: handlers.onCopy,
  });
  copyBtn.classList.add("media-popup-btn");

  const deleteBtn = buildPopupIconButton({
    icon: "delete",
    title: "Remove media",
    onClick: handlers.onRemove,
    variant: "danger",
  });
  deleteBtn.classList.add("media-popup-btn", "media-popup-btn-delete");

  srcRow.appendChild(srcInput);
  srcRow.appendChild(browseBtn);
  srcRow.appendChild(copyBtn);
  srcRow.appendChild(deleteBtn);

  // Row 2: Title input
  const titleRow = document.createElement("div");
  titleRow.className = "media-popup-row";

  const titleInput = buildPopupInput({
    placeholder: "Title (optional)...",
    fullWidth: true,
    className: "media-popup-title",
    onKeydown: handlers.onInputKeydown,
  });

  titleRow.appendChild(titleInput);

  // Row 3: Poster input (video only — hidden for audio by caller)
  const posterRow = document.createElement("div");
  posterRow.className = "media-popup-row";

  const posterInput = buildPopupInput({
    placeholder: "Poster image (optional)...",
    monospace: true,
    fullWidth: true,
    className: "media-popup-poster",
    onKeydown: handlers.onInputKeydown,
  });

  posterRow.appendChild(posterInput);

  container.appendChild(srcRow);
  container.appendChild(titleRow);
  container.appendChild(posterRow);

  return { container, srcInput, titleInput, posterInput, posterRow };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
}

export function installMediaPopupKeyboardNavigation(
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
