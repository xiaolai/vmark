/**
 * Format Toolbar DOM Builders
 *
 * Button definitions and DOM building utilities for the format toolbar.
 */

import { icons } from "./formatToolbarIcons";
import { getQuickLabel } from "@/plugins/sourceFormatPopup/languages";

// Button definitions with mark types (reordered per requirements)
export const FORMAT_BUTTONS = [
  { icon: icons.bold, title: "Bold (⌘B)", markType: "strong" },
  { icon: icons.italic, title: "Italic (⌘I)", markType: "emphasis" },
  { icon: icons.highlight, title: "Highlight (⌥⌘H)", markType: "highlight" },
  { icon: icons.strikethrough, title: "Strikethrough (⌘⇧X)", markType: "strike_through" },
  { icon: icons.link, title: "Link (⌘K)", markType: "link" },
  { icon: icons.superscript, title: "Superscript", markType: "superscript" },
  { icon: icons.subscript, title: "Subscript", markType: "subscript" },
  { icon: icons.code, title: "Inline Code (⌘`)", markType: "inlineCode" },
];

// Inline insert buttons (when cursor not in word, not at blank line)
export const INLINE_INSERT_BUTTONS = [
  { icon: icons.image, title: "Image", action: "inline-image" },
  { icon: icons.math, title: "Math", action: "inline-math" },
  { icon: icons.footnote, title: "Footnote", action: "footnote" },
];

// Block insert buttons (when cursor at beginning of blank line)
export const BLOCK_INSERT_BUTTONS = [
  { icon: icons.image, title: "Image", action: "block-image" },
  { icon: icons.orderedList, title: "Ordered List", action: "ordered-list" },
  { icon: icons.unorderedList, title: "Unordered List", action: "unordered-list" },
  { icon: icons.blockquote, title: "Blockquote", action: "blockquote" },
  { icon: icons.table, title: "Table", action: "table" },
  { icon: icons.divider, title: "Divider", action: "divider" },
];

// Heading buttons (level 0 = paragraph)
export const HEADING_BUTTONS = [
  { icon: icons.h1, title: "Heading 1 (⌘1)", level: 1 },
  { icon: icons.h2, title: "Heading 2 (⌘2)", level: 2 },
  { icon: icons.h3, title: "Heading 3 (⌘3)", level: 3 },
  { icon: icons.h4, title: "Heading 4 (⌘4)", level: 4 },
  { icon: icons.h5, title: "Heading 5 (⌘5)", level: 5 },
  { icon: icons.h6, title: "Heading 6 (⌘6)", level: 6 },
  { icon: icons.paragraph, title: "Paragraph (⌘0)", level: 0 },
];

/**
 * Build a generic action button.
 */
export function buildActionButton(
  iconSvg: string,
  title: string,
  onClick: () => void,
  variant?: "danger"
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = `format-toolbar-btn${variant ? ` format-toolbar-btn-${variant}` : ""}`;
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = iconSvg;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return btn;
}

/**
 * Build a visual divider between button groups.
 */
export function buildDivider(): HTMLElement {
  const divider = document.createElement("div");
  divider.className = "format-toolbar-divider";
  return divider;
}

/**
 * Build a format button (bold, italic, etc.).
 */
export function buildFormatButton(
  iconSvg: string,
  title: string,
  markType: string,
  onFormat: (markType: string) => void
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "format-toolbar-btn";
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = iconSvg;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFormat(markType);
  });

  return btn;
}

/**
 * Build a heading button (H1-H6, paragraph).
 */
export function buildHeadingButton(
  iconSvg: string,
  title: string,
  level: number,
  onHeadingChange: (level: number) => void
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "format-toolbar-btn";
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = iconSvg;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onHeadingChange(level);
  });

  return btn;
}

/**
 * Build an insert button (image, math, footnote, etc.).
 */
export function buildInsertButton(
  iconSvg: string,
  title: string,
  action: string,
  onInsert: (action: string) => void
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "format-toolbar-btn";
  btn.type = "button";
  btn.title = title;
  btn.innerHTML = iconSvg;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onInsert(action);
  });

  return btn;
}

/**
 * Build a quick language button.
 */
export function buildLanguageButton(
  name: string,
  isActive: boolean,
  onLanguageChange: (name: string) => void
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = `format-toolbar-quick-btn${isActive ? " active" : ""}`;
  btn.type = "button";
  btn.title = name;
  btn.textContent = getQuickLabel(name);

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLanguageChange(name);
  });

  return btn;
}
