/**
 * useSlidevControls — the Slidev deck half of the Knowledge Base controls,
 * split out of `useContentServer.ts` (which sits at the file-size cap).
 *
 * Two controls over the active deck, both routed through the content server:
 * PREVIEW opens the deck in the user's browser via the proxied Slidev dev
 * server — Slidev watches the file on disk, so a saved editor edit hot-reloads
 * the preview (WI-6.3, "editing reflects" on save) — and EXPORT writes it to a
 * chosen path.
 *
 * Both are fire-and-forget from the UI's point of view, so every failure is
 * CAUGHT rather than rejecting into a click handler. The save dialog itself is
 * inside that boundary too: a permission denial or a platform dialog failure is
 * reported, not an unhandled rejection.
 *
 * ONE envelope, written once (audit #757). Preview and export had the same
 * five-line preamble and the same catch/finally copied out: in-flight guard,
 * active-deck resolution, the `noDeck` toast, `toast.error(commandErrorMessage)`,
 * guard release. Two copies of one recovery policy is how the two controls come
 * to report a failure differently; `runDeckOperation` below owns it, and each
 * control is now only its own backend call.
 *
 * A deck failure is reported as a TOAST, never through the store's
 * `setError` (audit #758). `setError` moves the SERVER's lifecycle status to
 * `"error"`, so "no deck is open" — or a cancelled export, or an unsupported
 * extension — replaced a perfectly healthy running server with an error card,
 * and stopped `useContentServerWorkspaceSync` (which acts only on `"running"`)
 * from restarting it on a trust flip. These are action failures, not server
 * failures; the toast is the surface that says so without lying about the
 * server.
 *
 * Each control is SINGLE-FLIGHT (audit #756). Both are behind buttons: a second
 * preview while the first is still resolving could publish the older deck last,
 * and two exports can be pointed at one output path and race the write.
 *
 * @coordinates-with hooks/useContentServer.ts — mounts this; owns the server lifecycle
 * @coordinates-with services/contentServer/slidevDeck.ts — which deck is active
 * @module hooks/useSlidevControls
 */
import { useCallback, useRef, type RefObject } from "react";
import type { TFunction } from "i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { commandErrorMessage } from "@/services/commands/commandError";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { startSlidevPreview, exportSlidev } from "@/services/contentServer";
import {
  activeDeckPath,
  deckExportDefaultPath,
  slidevFormatFromPath,
} from "@/services/contentServer/slidevDeck";

export interface SlidevControls {
  /** Open a Slidev preview of the active deck in the external browser. */
  previewSlides: () => Promise<void>;
  /** Export the active deck (prompts for the output path). */
  exportSlides: () => Promise<void>;
}

/** The workspace root and active deck, or null when either is missing. */
function activeDeck(): { root: string; deck: string } | null {
  const root = useWorkspaceStore.getState().rootPath;
  const deck = activeDeckPath();
  if (!root || !deck) return null;
  return { root, deck };
}

/**
 * Run `operation` on the active deck under `guard`, with the whole envelope the
 * two controls share: single-flight, deck resolution, and the toast-not-store
 * failure report the header describes. A refused re-entry does nothing at all —
 * not even a toast — because the first click is still running.
 */
async function runDeckOperation(
  guard: RefObject<boolean>,
  t: TFunction,
  operation: (target: { root: string; deck: string }) => Promise<void>,
): Promise<void> {
  if (guard.current) return;
  const target = activeDeck();
  if (!target) {
    toast.error(t("contentServer.slidev.noDeck"));
    return;
  }
  guard.current = true;
  try {
    await operation(target);
  } catch (e) {
    toast.error(commandErrorMessage(e));
  } finally {
    guard.current = false;
  }
}

/** Prompt for an output path and export `deck` there, or report why not. */
async function promptAndExportDeck(
  t: TFunction,
  target: { root: string; deck: string },
): Promise<void> {
  // The dialog itself can throw (permission denied, platform dialog failure) —
  // it is inside `runDeckOperation`'s boundary so the failure becomes a toast
  // instead of rejecting this fire-and-forget control.
  const output = await save({
    defaultPath: deckExportDefaultPath(target.deck),
    filters: [
      { name: "PDF", extensions: ["pdf"] },
      { name: "PNG", extensions: ["png"] },
      { name: "PowerPoint", extensions: ["pptx"] },
    ],
  });
  if (!output) return; // user cancelled the save dialog
  const format = slidevFormatFromPath(output);
  // Any extension reads as PDF: refuse rather than write PDF bytes into `deck.docx` (#361).
  if (!output.toLowerCase().endsWith(`.${format}`)) {
    toast.error(t("contentServer.slidev.unsupportedFormat"));
    return;
  }
  await exportSlidev(target.root, target.deck, format, output);
}

export function useSlidevControls(t: TFunction): SlidevControls {
  // In-flight guards (#756) — one per operation, so a preview does not block an
  // export. Refs, not state: nothing renders from them.
  const previewing = useRef(false);
  const exporting = useRef(false);

  const previewSlides = useCallback(
    () =>
      runDeckOperation(previewing, t, async (target) => {
        const url = await startSlidevPreview(target.root, target.deck);
        useContentServerStore.getState().setSlidevDeck(target.deck);
        await openUrl(url);
      }),
    [t],
  );

  const exportSlides = useCallback(
    () => runDeckOperation(exporting, t, (target) => promptAndExportDeck(t, target)),
    [t],
  );

  return { previewSlides, exportSlides };
}
