/**
 * Link operations — ADR-010 unification surface.
 *
 * Shared logic between the Tiptap (wysiwyg) and CodeMirror (source) link
 * popups; the controllers themselves remain thin engine-specific wrappers
 * (`tiptap.ts`, `sourceLinkPopup/sourceLinkPopupPlugin.ts`). OPENING a link
 * lives one tier down, in `services/navigation/linkOpen.ts#openLinkTarget`,
 * because both controllers — which may not import each other — need it.
 *
 * This file is the first realization of the revised ADR-010 pattern:
 * one operations module per feature, two thin controllers. Future
 * unifications (footnote, math, wiki-link, image, link-create) follow
 * the same shape.
 *
 * @module plugins/linkPopup/operations
 */

import { classifyHref } from "@/services/navigation/linkOpen";

export type LinkAction =
  | { kind: "fragment"; targetId: string }
  | { kind: "external" }
  | { kind: "filepath" }
  | { kind: "noop" };

/** Classify a link href into the action the popup's "open" button performs. */
export function classifyLinkAction(href: string): LinkAction {
  const kind = classifyHref(href);
  if (kind === "fragment") {
    const targetId = href.startsWith("#") ? href.slice(1) : href;
    return { kind: "fragment", targetId };
  }
  if (kind === "external") return { kind: "external" };
  if (kind === "filepath") return { kind: "filepath" };
  return { kind: "noop" };
}
