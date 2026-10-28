/**
 * Transport normalization — the one difference review hides: the text an
 * incoming whole-text write becomes in the editor, with a leading BOM dropped
 * and CRLF or lone CR line endings turned into LF.
 *
 * Key decisions:
 *   - Transport only (ADR-AL10). Nothing else is folded: whitespace, a BOM
 *     inside the text, Unicode separators and Markdown-equivalent spellings
 *     are content, and review shows them.
 *   - It is the store's ingest rule (`ingestExternalText`), not a copy of it:
 *     the journal holds editor-domain text for every revision, so a script
 *     declared against any other text could never match what the write
 *     leaves in the buffer.
 *
 * @coordinates-with utils/editorText.ts — the ingest rule this names
 * @coordinates-with services/agentJournal/review/declaredScript.ts — declares the script against this text
 * @module services/agentJournal/review/transportNormalization
 */

import { ingestExternalText } from "@/utils/editorText";

/** The editor-domain text `raw` becomes: no leading BOM, LF line endings, nothing else changed. */
export function transportText(raw: string): string {
  return ingestExternalText(raw).canonicalEditorText;
}
