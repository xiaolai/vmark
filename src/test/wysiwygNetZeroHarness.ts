/**
 * Shared fixture for the WYSIWYG net-zero tests: a production Tiptap editor
 * with the provenance collector on tab "t1", loads and flushes the way the
 * production paths make them, edits that leave the Markdown unchanged, and a
 * freeze that decodes its window for the span oracle.
 *
 * @module test/wysiwygNetZeroHarness
 */
import { expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { useDocumentStore } from "@/stores/documentStore";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { setContentWithoutHistory } from "@/components/Editor/tiptapContentLoad";
import { freezeUnsavedProvenance } from "@/services/agentJournal/unsavedProvenance";
import { decodePayload } from "@/services/agentJournal/provenance/payload";
import type { Provenance } from "@/services/agentJournal/provenance/accumulator";
import { mapSpan } from "@/services/agentJournal/provenance/__tests__/spanMapping";
import { noteWysiwygFlush, wysiwygProvenanceExtension } from "@/services/agentJournal/collectors/wysiwyg/wysiwygCollector";
import { MAX_RETAINED_STEPS } from "@/services/agentJournal/collectors/wysiwyg/txnLedger";

const OPTS = { preserveBlankLines: true } as const;
export const store = () => useDocumentStore.getState();
const editors: Editor[] = [];

export function mount(tabId = "t1"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [...createTiptapExtensions(), wysiwygProvenanceExtension(tabId)] });
  editors.push(editor);
  return editor;
}

export function destroyEditors(): void {
  for (const e of editors.splice(0)) e.destroy();
}

/** A content load through the production load path (it notes the collector). */
export function load(editor: Editor, markdown: string): void {
  expect(setContentWithoutHistory(editor, parseMarkdown(editor.schema, markdown, OPTS), () => true, markdown)).toBe("applied");
}

/** A flush the way useTiptapFlush does it: note, then the store write. */
export function flush(editor: Editor, tabId = "t1"): string {
  const markdown = serializeMarkdown(editor.schema, editor.state.doc, OPTS);
  noteWysiwygFlush(editor, markdown, OPTS);
  store().setEditorContent(tabId, markdown);
  return markdown;
}

/** The ProseMirror position of the first occurrence of `needle` in a text node. */
export function posOf(editor: Editor, needle: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(needle)) at = pos + node.text!.indexOf(needle);
  });
  if (at < 0) throw new Error(`no text ${needle}`);
  return at;
}

/** A person deletes `needle` and types it again: two transactions, the same document text. */
export function deleteAndRetype(editor: Editor, needle: string): void {
  const at = posOf(editor, needle);
  editor.view.dispatch(editor.state.tr.delete(at, at + needle.length));
  editor.view.dispatch(editor.state.tr.insertText(needle, at));
}

/** Steps per transaction in `passStepBudget`. */
const STEPS_PER_TRANSACTION = 256;

/**
 * Net-zero transactions at `at` whose step maps, summed, pass the ledger's
 * step budget: the document text is unchanged after each one. Each stays
 * small because the editor's own plugins cost the square of one
 * transaction's step count (Tiptap's `getChangedRanges` inverts the whole
 * mapping per step); a single transaction over the budget is the ledger
 * unit test's case.
 */
export function passStepBudget(editor: Editor, at: number): void {
  for (let total = 0; total <= MAX_RETAINED_STEPS; total += STEPS_PER_TRANSACTION) {
    const tr = editor.state.tr;
    for (let i = 0; i < STEPS_PER_TRANSACTION; i += 2) tr.insertText("z", at).delete(at, at + 1);
    editor.view.dispatch(tr);
  }
}

export function typeAfter(editor: Editor, needle: string, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text, posOf(editor, needle) + needle.length));
}

/** Freeze the tab's window at `buffer`, record it, and decode what it certifies. */
export async function freezeDecoded(tabId: string, buffer: string): Promise<{ touched: boolean; p: Provenance }> {
  const f = freezeUnsavedProvenance(tabId, buffer)!;
  const named = await f.payload(null);
  expect(named).not.toBeNull();
  f.recorded(named!.basis);
  return { touched: f.touched, p: decodePayload(named!.payload) };
}

/** Where a hunk on `needle`'s first occurrence in `text` lands, and what blocks it. */
export function mapHunk(p: Provenance, text: string, needle: string) {
  const from = text.indexOf(needle);
  if (from < 0) throw new Error(`no hunk text ${needle}`);
  return mapSpan(p, { from, to: from + needle.length, growing: false });
}
