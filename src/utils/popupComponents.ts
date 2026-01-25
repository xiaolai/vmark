/**
 * Popup Components - DOM Builder Utilities
 *
 * Helper functions for building consistent popup UI components.
 * Used by vanilla DOM-based popup views (LinkPopup, WikiLinkPopup, etc.)
 */

// SVG Icons (feather-style, 24x24 viewBox)
export const popupIcons = {
  /** Open in external browser or navigate to file */
  open: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  /** Copy to clipboard */
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  /** Save/confirm checkmark */
  save: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  /** Delete/remove trash */
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  /** Close/cancel X */
  close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  /** Browse/folder for file selection */
  folder: `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  /** Go to / navigate to (down arrow) */
  goto: `<svg viewBox="0 0 24 24"><path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/></svg>`,
  /** Toggle/switch state */
  toggle: `<svg viewBox="0 0 24 24"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></svg>`,
  /** Link icon */
  link: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  /** Image/picture icon */
  image: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  /** Block image icon (image with frame) */
  blockImage: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  /** Inline image icon (image with text line) */
  inlineImage: `<svg viewBox="0 0 24 24"><rect x="2" y="6" width="10" height="10" rx="1"/><circle cx="5" cy="9" r="1.5"/><path d="m12 13-2-2-3 5"/><line x1="16" y1="8" x2="22" y2="8"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="16" y1="16" x2="22" y2="16"/></svg>`,
  /** Type/text icon (for paste as text) */
  type: `<svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
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
 * Filters out hidden elements (display: none) to handle cases where
 * some buttons may be conditionally hidden.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null); // Exclude hidden elements
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
