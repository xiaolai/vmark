/**
 * Source Link Popup Actions
 *
 * Actions for link editing in Source mode (CodeMirror 6).
 * Handles save, open, copy, and remove operations.
 */

import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { findHeadingByIdCM } from "@/utils/headingSlug";

/**
 * Build link markdown syntax.
 */
function buildLinkMarkdown(text: string, href: string): string {
  return `[${text}](${href})`;
}

function parseLinkMarkdown(markdown: string): { text: string; href: string } | null {
  const match = markdown.match(/^\[([^\]]*)\]\(([^)\s"]+)(?:\s+"[^"]*")?\)$/);
  if (!match) return null;
  return { text: match[1], href: match[2] };
}

function getLinkTextFromRange(view: EditorView, from: number, to: number): string {
  const markdown = view.state.doc.sliceString(from, to);
  const parsed = parseLinkMarkdown(markdown);
  return parsed?.text ?? markdown;
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

  const linkText = getLinkTextFromRange(view, linkFrom, linkTo);
  const newMarkdown = buildLinkMarkdown(linkText, href);

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

  // External link - open in browser
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } catch (error) {
    console.error("[SourceLinkPopup] Failed to open link:", error);
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
    console.error("[SourceLinkPopup] Copy failed:", error);
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
