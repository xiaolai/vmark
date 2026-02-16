/**
 * Media Popup DOM Helpers
 *
 * Purpose: Shared DOM construction and keyboard navigation for the unified media
 * popup UI. Handles all 4 media types (image, block_image, block_video, block_audio)
 * with conditional row visibility.
 *
 * @coordinates-with MediaPopupView.ts — consumes these helpers for popup DOM construction
 * @coordinates-with utils/popupComponents.ts — shared popup icon buttons and inputs
 * @module plugins/mediaPopup/mediaPopupDom
 */

import { isImeKeyEvent } from "@/utils/imeGuard";
import { buildPopupIconButton, buildPopupInput, popupIcons } from "@/utils/popupComponents";

import type { MediaNodeType } from "@/stores/mediaPopupStore";

interface MediaPopupDomHandlers {
  onBrowse: () => void;
  onCopy: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onInputKeydown: (e: KeyboardEvent) => void;
}

export interface MediaPopupDom {
  container: HTMLElement;
  srcInput: HTMLInputElement;
  // Image-specific (Row 2a)
  altRow: HTMLElement;
  altInput: HTMLInputElement;
  dimensionsSpan: HTMLElement;
  // Video/audio-specific (Row 2b)
  titleRow: HTMLElement;
  titleInput: HTMLInputElement;
  // Video-only (Row 3)
  posterRow: HTMLElement;
  posterInput: HTMLInputElement;
  // Image-only button
  toggleBtn: HTMLElement;
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

  // Toggle button (image-only: switch between inline/block)
  const toggleBtn = buildPopupIconButton({
    icon: "blockImage",
    title: "Toggle block/inline",
    onClick: handlers.onToggle,
  });
  toggleBtn.classList.add("media-popup-btn", "media-popup-btn-toggle");

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
  srcRow.appendChild(toggleBtn);
  srcRow.appendChild(deleteBtn);

  // Row 2a: Alt input + dimensions (image/block_image only)
  const altRow = document.createElement("div");
  altRow.className = "media-popup-row";

  const altInput = buildPopupInput({
    placeholder: "Caption (alt text)...",
    className: "media-popup-alt",
    onKeydown: handlers.onInputKeydown,
  });

  const dimensionsSpan = document.createElement("span");
  dimensionsSpan.className = "media-popup-dimensions";

  altRow.appendChild(altInput);
  altRow.appendChild(dimensionsSpan);

  // Row 2b: Title input (video/audio only)
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
  container.appendChild(altRow);
  container.appendChild(titleRow);
  container.appendChild(posterRow);

  return {
    container,
    srcInput,
    altRow,
    altInput,
    dimensionsSpan,
    titleRow,
    titleInput,
    posterRow,
    posterInput,
    toggleBtn,
  };
}

export function updateMediaPopupToggleButton(toggleBtn: HTMLElement, nodeType: MediaNodeType): void {
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
