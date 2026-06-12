/**
 * Link operations — ADR-010 unification surface.
 *
 * Shared logic between the Tiptap (wysiwyg) and CodeMirror (source) link
 * popups. Both controllers call these functions for navigation and edit
 * dispatch; the controllers themselves remain thin engine-specific
 * wrappers (`tiptap.ts`, `sourceLinkPopup/sourceLinkPopupPlugin.ts`).
 *
 * This file is the first realization of the revised ADR-010 pattern:
 * one operations module per feature, two thin controllers. Future
 * unifications (footnote, math, wiki-link, image, link-create) follow
 * the same shape.
 *
 * @module plugins/linkPopup/operations
 */

import { classifyHref, openFilepathLink } from "@/services/navigation/linkOpen";
import { linkPopupError } from "@/utils/debug";

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

/**
 * Engine-agnostic open. The Tiptap controller passes its EditorView for
 * fragment navigation; the CodeMirror controller passes `null` because
 * source mode does not support in-doc heading navigation today.
 */
export async function openLink(
  href: string,
  sourcePath: string | null,
  navigateToFragment: ((targetId: string) => boolean) | null,
): Promise<void> {
  const action = classifyLinkAction(href);

  switch (action.kind) {
    case "fragment":
      if (navigateToFragment) navigateToFragment(action.targetId);
      break;
    case "filepath":
      try {
        await openFilepathLink(href, sourcePath);
      } catch (err) {
        linkPopupError(err);
      }
      break;
    case "external":
    case "noop":
      break;
  }
}
