/**
 * Save normalization — turns editor-domain text into the exact bytes a save
 * writes: the document's line endings and hard-break spelling (resolved
 * against the user's on-save settings) and its byte-order mark.
 *
 * Key decisions:
 *   - The document's conventions are read when a save RUNS, not when it was
 *     submitted, so a queued save follows a convention that changed while it
 *     waited. A save whose document was closed before its turn has no live
 *     conventions to follow — the same tab id may name a different document by
 *     then — so it uses the ones captured when it was submitted.
 *   - Settings are always read at run time; they belong to the app, not to a
 *     document.
 *
 * @coordinates-with saveToPath.ts — the pipeline that normalizes each save
 * @coordinates-with saveTargetClaim.ts — `isSameDocument`, which picks the conventions
 * @module services/persistence/saveNormalize
 */
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  normalizeHardBreaks,
  normalizeLineEndings,
  resolveHardBreakStyle,
  resolveLineEndingOnSave,
} from "@/utils/linebreaks";
import type { DocumentState } from "@/stores/documentStore";
import type { NormalizedSaveContent } from "./normalizedSaveContent";

/** A document's file conventions, as the save reads them. */
export type SaveFormat = Pick<DocumentState, "lineEnding" | "hardBreakStyle" | "hasBom">;

/** The conventions of the document open as `tabId`, or none for an unknown tab. */
export function documentSaveFormat(tabId: string): SaveFormat | undefined {
  const doc = useDocumentStore.getState().getDocument(tabId);
  return doc && { lineEnding: doc.lineEnding, hardBreakStyle: doc.hardBreakStyle, hasBom: doc.hasBom };
}

/**
 * Apply `format` (resolved against the on-save settings) to `content`. An
 * absent format writes the settings' defaults with no byte-order mark.
 */
export function normalizeWithFormat(format: SaveFormat | undefined, content: string): NormalizedSaveContent {
  const settings = useSettingsStore.getState();
  const targetLineEnding = resolveLineEndingOnSave(
    format?.lineEnding ?? "unknown",
    settings.general.lineEndingsOnSave
  );
  const targetHardBreakStyle = resolveHardBreakStyle(
    format?.hardBreakStyle ?? "unknown",
    settings.markdown.hardBreakStyleOnSave
  );
  const hardBreakNormalized = normalizeHardBreaks(content, targetHardBreakStyle);
  const normalized = normalizeLineEndings(hardBreakNormalized, targetLineEnding);
  // Decision D1: the editor buffer is BOM-free and `hasBom` remembers that the
  // file began with U+FEFF. The save is the READER of that flag — without this
  // line it had writers and no readers, and a BOM'd file lost its mark on the
  // first save.
  const output = format?.hasBom ? `\u{FEFF}${normalized}` : normalized;
  return { output, targetLineEnding, targetHardBreakStyle };
}

/**
 * Resolve the on-save line-ending and hard-break styles from the document's
 * detected state plus user settings, and apply them to produce the bytes that
 * will be written to disk.
 *
 * @public — exported for the Phase 1 all-ingress matrix, which proves
 * round-trip fidelity against the REAL save pipeline rather than a re-implementation
 * that could drift from it.
 */
export function normalizeSaveContent(tabId: string, content: string): NormalizedSaveContent {
  return normalizeWithFormat(documentSaveFormat(tabId), content);
}
