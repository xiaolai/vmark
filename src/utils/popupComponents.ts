/**
 * Popup Components - DOM Builder Utilities
 *
 * Helper functions for building consistent popup UI components.
 * Used by vanilla DOM-based popup views (LinkPopup, WikiLinkPopup, etc.)
 */

// SVG Icons (feather-style, 24x24 viewBox)
export const popupIcons = {
  /** Open in external browser */
  open: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  /** Copy to clipboard */
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  /** Save/confirm checkmark */
  save: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  /** Delete/remove trash */
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  /** Close/cancel X */
  close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

export type PopupIconName = keyof typeof popupIcons;

export type PopupIconButtonVariant = "default" | "primary" | "danger";

export interface PopupIconButtonOptions {
  icon: PopupIconName;
  title: string;
  onClick: () => void;
  variant?: PopupIconButtonVariant;
  className?: string;
}

/**
 * Build an icon button for popup use.
 *
 * Features:
 * - 26x26px transparent button
 * - U-shaped underline focus indicator via CSS
 * - Hover state with background
 * - Optional variant (primary for save, danger for delete)
 */
export function buildPopupIconButton(
  options: PopupIconButtonOptions
): HTMLButtonElement {
  const { icon, title, onClick, variant = "default", className = "" } = options;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = popupIcons[icon];
  btn.addEventListener("click", onClick);

  // Build class list
  const classes = ["popup-icon-btn"];
  if (variant !== "default") {
    classes.push(`popup-icon-btn--${variant}`);
  }
  if (className) {
    classes.push(className);
  }
  btn.className = classes.join(" ");

  return btn;
}

export interface PopupInputOptions {
  placeholder?: string;
  value?: string;
  monospace?: boolean;
  fullWidth?: boolean;
  className?: string;
  onInput?: (value: string) => void;
  onKeydown?: (e: KeyboardEvent) => void;
}

/**
 * Build a borderless input for popup use.
 *
 * Features:
 * - Borderless, transparent background
 * - No focus ring (caret only)
 * - Optional monospace font for URLs/paths
 */
export function buildPopupInput(options: PopupInputOptions): HTMLInputElement {
  const {
    placeholder = "",
    value = "",
    monospace = false,
    fullWidth = false,
    className = "",
    onInput,
    onKeydown,
  } = options;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value;

  // Build class list
  const classes = ["popup-input"];
  if (monospace) {
    classes.push("popup-input--mono");
  }
  if (fullWidth) {
    classes.push("popup-input--full");
  }
  if (className) {
    classes.push(className);
  }
  input.className = classes.join(" ");

  // Event handlers
  if (onInput) {
    input.addEventListener("input", () => onInput(input.value));
  }
  if (onKeydown) {
    input.addEventListener("keydown", onKeydown);
  }

  return input;
}

/**
 * Build a preview text element for popup use.
 */
export function buildPopupPreview(className?: string): HTMLElement {
  const preview = document.createElement("div");
  preview.className = className ? `popup-preview ${className}` : "popup-preview";
  return preview;
}

/**
 * Build a button row container for popup actions.
 */
export function buildPopupButtonRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "popup-btn-row";
  return row;
}

/**
 * Build an input row container (input + buttons).
 */
export function buildPopupInputRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "popup-input-row";
  return row;
}

/**
 * Get all focusable elements within a container.
 * Used for Tab cycling in popups.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

/**
 * Handle Tab key for cycling focus within a popup.
 *
 * @param e - KeyboardEvent
 * @param container - The popup container element
 * @returns true if the event was handled, false otherwise
 */
export function handlePopupTabNavigation(
  e: KeyboardEvent,
  container: HTMLElement
): boolean {
  if (e.key !== "Tab") return false;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return false;

  const activeEl = document.activeElement as HTMLElement;
  const currentIndex = focusable.indexOf(activeEl);

  // Only handle if focus is inside the popup
  if (currentIndex === -1) return false;

  e.preventDefault();

  if (e.shiftKey) {
    const prevIndex =
      currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
    focusable[prevIndex].focus();
  } else {
    const nextIndex =
      currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
    focusable[nextIndex].focus();
  }

  return true;
}
