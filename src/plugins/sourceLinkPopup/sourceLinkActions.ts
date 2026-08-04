/**
 * Source Link Popup Actions
 *
 * Actions for link editing in Source mode (CodeMirror 6).
 * Handles save, open, copy, and remove operations.
 */

import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { StoreApi } from "@/plugins/sourcePopup";
import type { LinkPopupState } from "@/plugins/shared/popupPorts";

/** The popup state these actions read — injected, never imported (ADR-015). */
type Store = StoreApi<LinkPopupState>;
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
  if (!match) return null;
  return {
    text: match[1],
    href: match[2] || match[3],
    title: match[4] ?? null,
    useAngleBrackets: Boolean(match[2]),
  };
}

/**
 * Stale-range guard (WI-1 / D1): the captured `[from, to)` is only safe to
 * mutate while it is in bounds and still holds link markdown. A concurrent
 * edit (MCP, AI suggestion, external reload) shifts or destroys the range —
 * dispatching the captured offsets blindly would rewrite unrelated text.
 * Mirrors WYSIWYG `linkRangeIsIntact` (commit c89c1656).
 */
function getIntactLinkFromRange(
  view: EditorView,
  from: number,
  to: number
): { text: string; href: string; title: string | null; useAngleBrackets: boolean } | null {
  if (from < 0 || to <= from || to > view.state.doc.length) return null;
  return parseLinkMarkdown(view.state.doc.sliceString(from, to));
}

/**
 * The user's intent, read at ACTION time (audit 20260804-F2).
 *
 * The popup closes on the same click that starts a save/remove, and closing
 * RESETS the store (`href: ""`, `linkFrom: 0`, `linkTo: 0`). While the user is
 * mid-composition the action is queued instead of run, so reading the store
 * inside the queued callback saw the reset values — `0..0` fails the intact-
 * range check and the edit was dropped with only a debug line. Capturing the
 * intent up front is what makes a CJK user's save survive the deferral; the
 * RANGE is still re-validated against the live doc at execution time, so the
 * capture never licenses a stale write.
 */
interface LinkEditIntent {
  href: string;
  linkFrom: number;
  linkTo: number;
  closePopup: (() => void) | undefined;
}

function captureIntent(store: Store): LinkEditIntent {
  const { href, linkFrom, linkTo, closePopup } = store.getState();
  return { href, linkFrom, linkTo, closePopup };
}

/**
 * Save link changes to the document.
 * Replaces the current link markdown with updated values.
 *
 * Guards:
 *   - intent (URL + range) captured at ACTION time, before the popup closes;
 *   - range RE-VALIDATED inside the queued action against the live doc, so a
 *     stale/destroyed range → abort, close the popup, never dispatch (D1);
 *   - empty/whitespace URL → unlink (keep the text), matching WYSIWYG (D7).
 */
export function saveLinkChanges(view: EditorView, store: Store): void {
  const { href, linkFrom, linkTo, closePopup } = captureIntent(store);

  runOrQueueCodeMirrorAction(view, () => {
    const parsed = getIntactLinkFromRange(view, linkFrom, linkTo);
    if (!parsed) {
      sourceActionError("Stale link range — skipping save:", { linkFrom, linkTo });
      closePopup?.();
      return;
    }

    const insert = href.trim()
      ? buildLinkMarkdown(parsed.text, href, parsed.title, parsed.useAngleBrackets)
      : parsed.text;

    view.dispatch({
      changes: { from: linkFrom, to: linkTo, insert },
    });
  });
}

/**
 * Open link in browser or navigate to bookmark.
 */
export async function openLink(view: EditorView, store: Store): Promise<void> {
  const { href } = store.getState();
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
      store.getState().closePopup();
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
export async function copyLinkHref(store: Store): Promise<void> {
  const { href } = store.getState();

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
 * Same stale-range guard as saveLinkChanges (D1): abort + close, never
 * dispatch captured offsets that no longer hold the link.
 */
export function removeLink(view: EditorView, store: Store): void {
  const { linkFrom, linkTo, closePopup } = captureIntent(store);

  runOrQueueCodeMirrorAction(view, () => {
    const parsed = getIntactLinkFromRange(view, linkFrom, linkTo);
    if (!parsed) {
      sourceActionError("Stale link range — skipping remove:", { linkFrom, linkTo });
      closePopup?.();
      return;
    }

    // Replace with just the text (remove link formatting)
    view.dispatch({
      changes: { from: linkFrom, to: linkTo, insert: parsed.text },
    });
  });
}
