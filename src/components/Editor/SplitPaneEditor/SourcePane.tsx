// WI-1A.4 — SourcePane.
//
// CodeMirror-backed source editor for split-pane / viewer formats.
// Phase 1A delivers raw CodeMirror with line numbers, undo, find,
// keyboard editing, and the basic keymap. Phase 2 adapters wire
// language packs (loadLanguage), validators (linter → ValidationGutter),
// and per-format extras (loadExtraExtensions).

import { useEffect, useRef } from "react";
import { EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { useDocumentStore } from "@/stores/documentStore";
import type { FormatConfig } from "@/lib/formats/types";

export interface SourcePaneProps {
  tabId: string;
  formatId: string;
  formatConfig: FormatConfig;
}

export function SourcePane({ tabId, formatId, formatConfig }: SourcePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Track the doc string we last *wrote* via a transaction so we can
  // skip echoing the store update back into the view (which would
  // collapse the cursor and reset undo position).
  const lastSyncedRef = useRef<string>("");

  /* v8 ignore next 4 -- @preserve documentStore selector path; smoke-tested via mocked store */
  const storeContent = useDocumentStore(
    (state) => state.documents?.[tabId]?.content ?? "",
  );
  const readOnly = formatConfig.adapters.readOnlyDefault;

  // One-time mount per (tabId, formatId, readOnly). Document persistence
  // wires via the documentStore.setContent action on every doc change.
  useEffect(() => {
    /* v8 ignore next -- @preserve null-host fallback for jsdom edges */
    if (!containerRef.current) return undefined;

    const persistOnUpdate = EditorView.updateListener.of((update) => {
      /* v8 ignore next -- @preserve no-op for non-doc updates */
      if (!update.docChanged) return;
      const next = update.state.doc.toString();
      lastSyncedRef.current = next;
      useDocumentStore.getState().setContent(tabId, next);
    });

    const baseExtensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      persistOnUpdate,
    ];
    if (readOnly) baseExtensions.push(EditorState.readOnly.of(true));

    const initial = useDocumentStore.getState().documents?.[tabId]?.content ?? "";
    lastSyncedRef.current = initial;
    const view = new EditorView({
      state: EditorState.create({
        doc: initial,
        extensions: baseExtensions,
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
     
  }, [tabId, formatId, readOnly]);

  // Re-sync the editor when the store content diverges from the last
  // value we authored. Handles file-load races (initDocument arriving
  // after the editor mounts) and external reloads.
  useEffect(() => {
    const view = viewRef.current;
    /* v8 ignore next -- @preserve unmounted-view fallback */
    if (!view) return;
    if (storeContent === lastSyncedRef.current) return;
    const current = view.state.doc.toString();
    if (current === storeContent) {
      lastSyncedRef.current = storeContent;
      return;
    }
    // addToHistory: false — store→view sync (file load, external
    // reload) must not appear in the undo stack; otherwise Cmd-Z would
    // revert to the empty pre-load buffer.
    view.dispatch({
      changes: { from: 0, to: current.length, insert: storeContent },
      annotations: [Transaction.addToHistory.of(false)],
    });
    lastSyncedRef.current = storeContent;
  }, [storeContent]);

  return (
    <div
      className="source-pane"
      data-testid="source-pane"
      data-tab-id={tabId}
      data-format-id={formatId}
      data-language-loader={formatConfig.loadLanguage ? "lazy" : "none"}
    >
      <div
        ref={containerRef}
        className="source-pane__editor"
        aria-readonly={readOnly}
      />
    </div>
  );
}

export default SourcePane;
