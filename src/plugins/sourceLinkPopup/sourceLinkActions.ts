/**
 * Source Link Popup Actions
 *
 * Actions for link editing in Source mode (CodeMirror 6).
 * Handles save, open, copy, and remove operations.
 */

import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { sourceActionError } from "@/utils/debug";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { findHeadingByIdCM } from "@/utils/headingSlug";

/**
 * Build link markdown syntax.
 */
function buildLinkMarkdown(
  text: string,
  href: string,
  title: string | null,
  useAngleBrackets: boolean
): string {
  const shouldUseAngleBrackets = useAngleBrackets || /\s/.test(href);
  const dest = shouldUseAngleBrackets ? `<${href}>` : href;
  const titlePart = title ? ` "${title}"` : "";
  return `[${text}](${dest}${titlePart})`;
}

function parseLinkMarkdown(
  markdown: string
): { text: string; href: string; title: string | null; useAngleBrackets: boolean } | null {
  const match = markdown.match(
    /^\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"([^"]*)")?\)$/
  );
  /* v8 ignore next -- @preserve reason: non-link markdown passed to parseLinkMarkdown not tested */
  if (!match) return null;
  return {
    text: match[1],
    href: match[2] || match[3],
    title: match[4] ?? null,
    useAngleBrackets: Boolean(match[2]),
  };
}

function getLinkTextFromRange(view: EditorView, from: number, to: number): string {
  const markdown = view.state.doc.sliceString(from, to);
  const parsed = parseLinkMarkdown(markdown);
  /* v8 ignore next -- @preserve reason: link text range always contains valid link markdown */
  return parsed?.text ?? markdown;
}

function getLinkMetaFromRange(
  view: EditorView,
  from: number,
  to: number
): { text: string; title: string | null; useAngleBrackets: boolean } {
  const markdown = view.state.doc.sliceString(from, to);
  const parsed = parseLinkMarkdown(markdown);
  /* v8 ignore next -- @preserve reason: metadata range always contains valid link markdown */
  if (!parsed) {
    return { text: markdown, title: null, useAngleBrackets: false };
  }
  return {
    text: parsed.text,
    title: parsed.title,
    useAngleBrackets: parsed.useAngleBrackets,
  };
}

/**
 * Save link changes to the document.
 * Replaces the current link markdown with updated values.
 */
export function saveLinkChanges(view: EditorView): void {
  const state = useLinkPopupStore.getState();
  const { href, linkFrom, linkTo } = state;

  if (linkFrom < 0 || linkTo < 0) {
    return;
  }

  const { text, title, useAngleBrackets } = getLinkMetaFromRange(view, linkFrom, linkTo);
  const newMarkdown = buildLinkMarkdown(text, href, title, useAngleBrackets);

  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: linkFrom,
        to: linkTo,
        insert: newMarkdown,
      },
    });
  });
}

/**
 * Open link in browser or navigate to bookmark.
 */
export async function openLink(view: EditorView): Promise<void> {
  const { href } = useLinkPopupStore.getState();
  if (!href) return;

  // Handle bookmark links - navigate to heading
  if (href.startsWith("#")) {
    const targetId = href.slice(1);
    const doc = view.state.doc;
    const pos = findHeadingByIdCM(doc, targetId);

    if (pos !== null) {
      runOrQueueCodeMirrorAction(view, () => {
        // Move cursor to the heading position
        view.dispatch({
          selection: { anchor: pos + 1 },
          scrollIntoView: true,
        });
      });
      useLinkPopupStore.getState().closePopup();
      view.focus();
    }
    return;
  }

  // External link - open in browser (scheme-allowlisted opener,
  // audit 20260612)
  try {
    const { openExternalLink } = await import("@/services/navigation/linkOpen");
    await openExternalLink(href);
  } catch (error) {
    /* v8 ignore next -- @preserve reason: dynamic import failure not tested */
    sourceActionError("Failed to open link:", error);
  }
}

/**
 * Copy link URL to clipboard.
 */
export async function copyLinkHref(): Promise<void> {
  const { href } = useLinkPopupStore.getState();

  if (!href) {
    return;
  }

  try {
    await writeText(href);
  } catch (error) {
    sourceActionError("Copy failed:", error);
  }
}

/**
 * Remove link from the document.
 * Removes the link markdown syntax but keeps the text content.
 */
export function removeLink(view: EditorView): void {
  const state = useLinkPopupStore.getState();
  const { linkFrom, linkTo } = state;

  if (linkFrom < 0 || linkTo < 0) {
    return;
  }

  // Replace with just the text (remove link formatting)
  const linkText = getLinkTextFromRange(view, linkFrom, linkTo);
  runOrQueueCodeMirrorAction(view, () => {
    view.dispatch({
      changes: {
        from: linkFrom,
        to: linkTo,
        insert: linkText,
      },
    });
  });
}
