// WI-1A.4 — SourcePane.
//
// CodeMirror-backed source editor for split-pane / viewer formats.
// Phase 1A delivers raw CodeMirror with line numbers, undo, find,
// keyboard editing, and the basic keymap. Phase 2 adapters wire
// language packs (loadLanguage), validators (linter → ValidationGutter),
// and per-format extras (loadExtraExtensions).

import { useEffect, useRef, useState } from "react";
import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, type Diagnostic } from "@codemirror/lint";
import { useDocumentStore } from "@/stores/documentStore";
import type {
  FormatConfig,
  ValidationDiagnostic,
} from "@/lib/formats/types";

export interface SourcePaneProps {
  tabId: string;
  formatId: string;
  formatConfig: FormatConfig;
  /** Optional callback so the parent can hoist diagnostics into preview / gutter. */
  onDiagnostics?: (diagnostics: ValidationDiagnostic[]) => void;
  /** Imperative jump-to-position handle. Parent passes a ref-setter; the
   *  SourcePane installs a callback that focuses the editor and moves the
   *  cursor to (line, column). Used by ValidationGutter row clicks. */
  onJumpHandleReady?: (jump: (line: number, column: number) => void) => void;
  /** WI-4.3 — per-tab override. When true, the editor mounts in
   *  read-write mode regardless of formatConfig.adapters.readOnlyDefault. */
  editingEnabled?: boolean;
}

function diagnosticToCodemirror(
  doc: {
    line: (n: number) => { from: number; to: number; length: number };
    lines: number;
  },
  d: ValidationDiagnostic,
): Diagnostic {
  // Clamp line/endLine to the doc's real line range so an out-of-range
  // diagnostic (parser reports past EOF; doc shrunk between validate and
  // render) doesn't throw inside doc.line() and break linting.
  const totalLines = Math.max(1, doc.lines);
  const startLine = Math.min(Math.max(1, d.line), totalLines);
  const lineInfo = doc.line(startLine);
  const from = Math.min(
    lineInfo.from + Math.max(0, d.column - 1),
    lineInfo.to,
  );
  let to: number;
  if (d.endLine !== undefined && d.endColumn !== undefined) {
    const endLine = Math.min(Math.max(1, d.endLine), totalLines);
    const endLineInfo = doc.line(endLine);
    to = Math.min(
      endLineInfo.from + Math.max(0, d.endColumn - 1),
      endLineInfo.to,
    );
  } else {
    to = Math.min(from + 1, lineInfo.to);
  }
  return {
    from,
    to: to <= from ? Math.min(from + 1, lineInfo.to) : to,
    severity: d.severity,
    message: d.message,
    source: d.ruleId,
  };
}

export function SourcePane({
  tabId,
  formatId,
  formatConfig,
  onDiagnostics,
  onJumpHandleReady,
  editingEnabled = false,
}: SourcePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(new Compartment());
  // Track the doc string we last *wrote* via a transaction so we can
  // skip echoing the store update back into the view (which would
  // collapse the cursor and reset undo position).
  const lastSyncedRef = useRef<string>("");
  const [, setLanguageLoaded] = useState(false);

  /* v8 ignore next 4 -- @preserve documentStore selector path; smoke-tested via mocked store */
  const storeContent = useDocumentStore(
    (state) => state.documents?.[tabId]?.content ?? "",
  );
  // WI-4.3 — readOnly defers to the per-tab editing override when set.
  const readOnly = formatConfig.adapters.readOnlyDefault && !editingEnabled;
  const validator = formatConfig.validator;
  const loadLanguage = formatConfig.loadLanguage;

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

    // WI-2.4 — wire format.validator into CodeMirror's lint gutter so
    // parse errors (json/yaml/toml) surface as gutter markers, and
    // hoist diagnostics via onDiagnostics so the preview pane can
    // surface "fix syntax errors at line:column".
    const validationLinter = validator
      ? linter((view) => {
          const text = view.state.doc.toString();
          const path =
            useDocumentStore.getState().documents?.[tabId]?.filePath ??
            undefined;
          const diagnostics = validator(text, path ?? undefined);
          onDiagnostics?.(diagnostics);
          return diagnostics.map((d) =>
            diagnosticToCodemirror(view.state.doc, d),
          );
        })
      : null;

    const baseExtensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      // Empty initial language — loadLanguage promise reconfigures
      // this compartment when ready.
      languageCompartmentRef.current.of([]),
      persistOnUpdate,
    ];
    if (validationLinter) baseExtensions.push(validationLinter);
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

    // Expose an imperative jump-to-position handle so the validation
    // gutter (parent) can move the cursor on row click.
    if (onJumpHandleReady) {
      onJumpHandleReady((line: number, column: number) => {
        const v = viewRef.current;
        if (!v) return;
        const totalLines = v.state.doc.lines;
        const safeLine = Math.min(Math.max(1, line), Math.max(1, totalLines));
        const lineInfo = v.state.doc.line(safeLine);
        const pos = Math.min(
          lineInfo.from + Math.max(0, column - 1),
          lineInfo.to,
        );
        v.dispatch({ selection: { anchor: pos, head: pos } });
        v.focus();
      });
    }

    let cancelled = false;
    if (loadLanguage) {
      void loadLanguage()
        .then((lang) => {
          /* v8 ignore next -- @preserve unmount race */
          if (cancelled || !viewRef.current) return;
          viewRef.current.dispatch({
            effects: languageCompartmentRef.current.reconfigure(lang),
          });
          setLanguageLoaded(true);
        })
        .catch(() => {
          /* v8 ignore next 2 -- @preserve language pack failures fall back to plain text */
          /* swallow — raw CodeMirror is the fallback */
        });
    }

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };

  }, [tabId, formatId, readOnly, validator, loadLanguage, onDiagnostics, onJumpHandleReady]);

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
