/**
 * The one implementation of the `lineEndingsLF` / `lineEndingsCRLF` actions.
 *
 * Purpose: line endings are METADATA in this app — `documentStore.content` is
 * LF-canonical, and `saveToPath` applies the document's convention at write
 * time. So "convert to CRLF" means "record that this document's convention is
 * CRLF", nothing more.
 *
 * Both surfaces used to round-trip the whole document through
 * `normalizeLineEndings` anyway. On Source that was pure waste — CodeMirror
 * normalises CRLF back to LF on insert — with two real side effects: an undo
 * entry that restores nothing, and a collapsed selection. On WYSIWYG it was
 * worse: remark preserves `\r\n` inside a paragraph, so the CR survived into
 * ProseMirror text nodes — the LF-invariant violation shipped as a feature
 * (WI-1.7).
 *
 * Key decisions:
 *   - No tab → false. The action did nothing; claiming success would make a
 *     no-op look like a conversion.
 *   - The buffer, undo history and selection are untouched by contract; the
 *     tests on both surfaces pin exactly that.
 *
 * @coordinates-with plugins/toolbarActions/sourceCjkActions.ts — Source delegate
 * @coordinates-with plugins/toolbarActions/wysiwygAdapterCjk.ts — WYSIWYG delegate
 * @coordinates-with services/persistence/saveToPath.ts — applies the convention
 * @module services/formats/lineEndingMetadata
 */
import { getWindowLabel } from "@/services/navigation/windowFocus";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";

/** Record the active document's line-ending convention. Metadata only. */
export function setDocumentLineEnding(target: "lf" | "crlf"): boolean {
  const windowLabel = getWindowLabel();
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (!tabId) return false;

  useDocumentStore.getState().setLineMetadata(tabId, { lineEnding: target });
  return true;
}
