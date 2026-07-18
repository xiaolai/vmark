/**
 * Search Replace Actions (WYSIWYG)
 *
 * Purpose: Replace Current / Replace All handlers for the search plugin.
 *
 * Key decisions:
 *   - Transactions are constructed INSIDE the IME-guard callback against the
 *     view's CURRENT state: an action queued during composition would
 *     otherwise dispatch a transaction built from a stale state and throw
 *     "mismatched transaction".
 *   - Targets are re-validated with a fresh findMatchesInDoc scan at
 *     execution time: within the 200ms doc-change debounce the plugin's
 *     match list holds mapped POSITIONS whose text may no longer match the
 *     query. Replace Current skips a range that is no longer a live match;
 *     Replace All simply operates on the fresh scan.
 *
 * @coordinates-with tiptap.ts — wires these handlers to the search:replace-* events
 * @coordinates-with findMatches.ts — fresh scan used for re-validation
 * @module plugins/search/replaceActions
 */

import type { EditorView } from "@tiptap/pm/view";
import { useUIStore } from "@/stores/uiStore";
import { runOrQueueProseMirrorAction } from "@/utils/imeGuard";
import { findMatchesInDoc, type Match } from "./findMatches";

function scanCurrentDoc(view: EditorView): Match[] {
  const { query, caseSensitive, wholeWord, useRegex } = useUIStore.getState().search;
  return findMatchesInDoc(view.state.doc, query, caseSensitive, wholeWord, useRegex);
}

/**
 * Build the Replace Current / Replace All handlers for a view.
 * `getMatches` reads the plugin state's (possibly mapped) match list at
 * execution time — needed to resolve which range `currentIndex` points at.
 */
export function createReplaceHandlers(
  editorView: EditorView,
  getMatches: () => Match[] | undefined,
) {
  const replaceCurrent = () => {
    if (editorView.editable === false) return;
    const { isOpen, currentIndex } = useUIStore.getState().search;
    if (!isOpen || currentIndex < 0) return;

    runOrQueueProseMirrorAction(editorView, () => {
      if (editorView.isDestroyed) return;
      const search = useUIStore.getState().search;
      if (!search.isOpen || search.currentIndex < 0) return;

      const match = getMatches()?.[search.currentIndex];
      if (!match) return;

      // Re-validate: mapped positions survive edits, but the text underneath
      // may have changed. Only replace when this exact range is still a live
      // match for the current query.
      const fresh = scanCurrentDoc(editorView);
      if (!fresh.some((m) => m.from === match.from && m.to === match.to)) return;

      const tr = editorView.state.tr.replaceWith(
        match.from,
        match.to,
        search.replaceText ? editorView.state.schema.text(search.replaceText) : [],
      );
      editorView.dispatch(tr);

      requestAnimationFrame(() => {
        useUIStore.getState().searchFindNext();
      });
    });
  };

  const replaceAll = () => {
    if (editorView.editable === false) return;
    const { isOpen, query } = useUIStore.getState().search;
    if (!isOpen || !query) return;

    runOrQueueProseMirrorAction(editorView, () => {
      if (editorView.isDestroyed) return;
      const search = useUIStore.getState().search;
      if (!search.isOpen || !search.query) return;

      // Fresh scan at execution time — the plugin's mapped list can be stale
      // within the debounce window (and misses matches created by the edit).
      const fresh = scanCurrentDoc(editorView);
      if (fresh.length === 0) return;

      // Reverse order so earlier positions stay valid while replacing.
      const sorted = [...fresh].sort((a, b) => b.from - a.from);
      let tr = editorView.state.tr;
      for (const match of sorted) {
        tr = tr.replaceWith(
          match.from,
          match.to,
          search.replaceText ? editorView.state.schema.text(search.replaceText) : [],
        );
      }
      editorView.dispatch(tr);
    });
  };

  return { replaceCurrent, replaceAll };
}
