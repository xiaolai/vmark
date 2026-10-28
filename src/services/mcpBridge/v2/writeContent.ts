/**
 * Write content — replace a tab's whole document from a bridge handler and
 * return the revision token it is then at.
 *
 * The store takes the content as an EDIT that keeps the document's disk
 * convention. A Markdown tab the live WYSIWYG editor is showing is then
 * loaded into that editor, which leaves the store holding the editor's
 * serialization (see `liveEditor.ts`); a background or Source-mode tab is
 * store-only — the live editor shows a different document, and dispatching
 * into it would replace that one.
 *
 * The revision is bumped HERE, last, so the token returned is by
 * construction the document's newest: nothing after this point changes the
 * document. A load whose flush fails throws before the bump; the journaled
 * edit's recovery bumps it once the store has caught up.
 *
 * @coordinates-with liveEditor.ts — the composition refusal and the live load
 * @coordinates-with document.ts — transform
 * @coordinates-with documentWrite.ts — write, after its journal re-verify
 * @module services/mcpBridge/v2/writeContent
 */

import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { liveCompositionRefusal, loadIntoLiveWysiwyg } from "./liveEditor";
import type { DocumentKind, V2Error } from "./types";

/**
 * Replace the content, or answer — with nothing changed — INVALID_TAB when
 * the tab has no document, or BUSY while the live WYSIWYG editor showing the
 * tab has an IME composition in progress. Does NOT call `respond`; callers
 * decide how to package the result.
 */
export function writeContent(
  tabId: string,
  content: string,
  kind: DocumentKind,
): { revision: string } | V2Error {
  if (!useDocumentStore.getState().documents[tabId]) {
    return { error: "INVALID_TAB", message: `tab ${tabId} has no document` };
  }
  const refusal = liveCompositionRefusal(tabId);
  if (refusal) return refusal;
  useDocumentStore.getState().ingestExternalContent(tabId, content, "mcp-write");
  // Its result needs no branch: either the editor kept its old document and
  // the store holds `content`, or the editor took it and the store now holds
  // the editor's serialization. The caller reads the store back as the postimage.
  // It throws when the editor took the content but the flush failed: the
  // caller's `recover` (`recoverLiveWysiwyg`) brings the store up to the editor.
  if (kind === "markdown") loadIntoLiveWysiwyg(tabId, content);
  return { revision: useRevisionStore.getState().updateRevision(tabId) };
}
