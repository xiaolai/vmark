/**
 * linkCreatePopup operations — ADR-010 pattern.
 *
 * Shared logic between the Tiptap (wysiwyg) and CodeMirror (source)
 * link-create popups. Both controllers normalize and validate the URL
 * input the user typed before inserting a link.
 *
 * @module plugins/linkCreatePopup/operations
 */

import { classifyHref } from "@/utils/linkOpen";

/** Trim and trim trailing dot/comma stragglers a user may have pasted. */
export function normalizeHref(input: string): string {
  return input.trim().replace(/[.,)]+$/, "");
}

/**
 * Validate whether the input is suitable to commit as a link href.
 * Engine-agnostic — both controllers call this before applying any edit.
 */
export function isValidHref(input: string): boolean {
  const href = normalizeHref(input);
  if (!href) return false;
  // Fragment, filepath, and external all accept; reject only empty / whitespace.
  const kind = classifyHref(href);
  return kind === "fragment" || kind === "external" || kind === "filepath";
}

/** When the user submits without explicit link text, derive it from the href. */
export function deriveLinkText(href: string): string {
  const trimmed = normalizeHref(href);
  if (trimmed.startsWith("#")) return trimmed.slice(1);
  // Last URL/path segment as a readable default.
  const segments = trimmed.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? trimmed;
  return last || trimmed;
}
