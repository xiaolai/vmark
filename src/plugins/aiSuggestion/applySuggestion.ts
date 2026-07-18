/**
 * Purpose: suggestion apply + position remap logic for the aiSuggestion
 * plugin (extracted from tiptap.ts for the file-size baseline; tiptap.ts
 * re-exports both, so existing imports are unchanged).
 *
 * @coordinates-with tiptap.ts — decoration plugin consuming these
 * @module plugins/aiSuggestion/applySuggestion
 */
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Mapping } from "@tiptap/pm/transform";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import type { AiSuggestion } from "./types";

/**
 * Check if suggestion positions are valid within document bounds.
 * @exported for testing
 */
export function isValidPosition(suggestion: AiSuggestion, docSize: number): boolean {
  return suggestion.from >= 0 && suggestion.to <= docSize && suggestion.from <= suggestion.to;
}

/**
 * Apply a suggestion's document change on a transaction.
 * Shared by button handler, handleAccept, and handleAcceptAll.
 * Exported for unit testing only.
 */
export function applySuggestionToTr(
  state: EditorState,
  tr: Transaction,
  suggestion: AiSuggestion,
): Transaction {
  const docSize = tr.doc.content.size;

  // Whole-document replace: always clamp `to` to current doc size. The doc
  // may have grown or shrunk since the suggestion was created, but the
  // intent is to replace the entire content — so we use the live size.
  // Without this, a doc that grew after creation leaves uncovered trailing
  // content intact, duplicating it alongside the replacement (issue #805).
  // The marker is the explicit wholeDoc flag — `from === 0` is NOT a safe
  // sentinel, since a first-block suggestion legitimately starts at 0 and
  // must NOT swallow the whole document (cross-model review, audit
  // 20260612 remediation).
  if (suggestion.wholeDoc) {
    suggestion = { ...suggestion, to: docSize };
  }

  // Guard against stale positions after doc edits
  if (!isValidPosition(suggestion, docSize)) return tr;

  switch (suggestion.type) {
    case "insert": {
      if (suggestion.newContent != null) {
        const slice = createMarkdownPasteSlice(state, suggestion.newContent);
        return tr.replaceRange(suggestion.from, suggestion.from, slice);
      }
      break;
    }
    case "replace": {
      if (suggestion.newContent != null) {
        const slice = createMarkdownPasteSlice(state, suggestion.newContent);
        return tr.replaceRange(suggestion.from, suggestion.to, slice);
      }
      break;
    }
    case "delete": {
      return tr.delete(suggestion.from, suggestion.to);
    }
  }
  return tr;
}

/**
 * Whether any replaced region of the mapping strictly overlaps [from, to).
 * Tracks the range through each step so multi-step transactions test against
 * the right coordinate space.
 */
function rangeTouched(mapping: Mapping, from: number, to: number): boolean {
  let f = from;
  let t = to;
  for (const stepMap of mapping.maps) {
    let touched = false;
    stepMap.forEach((oldStart, oldEnd) => {
      if (oldStart < t && oldEnd > f) touched = true;
      // A point suggestion (f === t) deleted by a covering range.
      if (f === t && oldStart < f && oldEnd > f) touched = true;
    });
    if (touched) return true;
    f = stepMap.map(f, 1);
    t = stepMap.map(t, -1);
    if (t < f) t = f;
  }
  return false;
}

/**
 * Compute remapped suggestion ranges after a document-changing transaction
 * (audit H8 — stored from/to are absolute and must follow the document).
 *
 * - Edits outside a suggestion's range shift it (content-tracking assoc).
 * - Edits that touch the range content dismiss the suggestion (`range: null`)
 *   — the user is rewriting the text the AI targeted, so it is stale.
 * - Whole-document suggestions (wholeDoc flag) survive all edits: accept clamps
 *   `to` to the live doc size (issue #805); only `to` is tracked for display.
 *
 * Exported for unit testing.
 */
export function computeSuggestionRemap(
  suggestions: Iterable<AiSuggestion>,
  mapping: Mapping
): Array<{ id: string; range: { from: number; to: number } | null }> {
  const updates: Array<{ id: string; range: { from: number; to: number } | null }> = [];
  for (const s of suggestions) {
    if (s.wholeDoc) {
      updates.push({ id: s.id, range: { from: 0, to: mapping.map(s.to, -1) } });
      continue;
    }
    if (rangeTouched(mapping, s.from, s.to)) {
      updates.push({ id: s.id, range: null });
      continue;
    }
    if (s.from === s.to) {
      const pos = mapping.map(s.from, 1);
      updates.push({ id: s.id, range: { from: pos, to: pos } });
      continue;
    }
    updates.push({
      id: s.id,
      range: { from: mapping.map(s.from, 1), to: mapping.map(s.to, -1) },
    });
  }
  return updates;
}
