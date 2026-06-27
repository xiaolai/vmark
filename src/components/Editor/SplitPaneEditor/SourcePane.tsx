// WI-1A.4 — SourcePane.
//
// CodeMirror-backed source editor for split-pane / viewer formats.
// Phase 1A delivers raw CodeMirror with line numbers, undo, find,
// keyboard editing, and the basic keymap. Phase 2 adapters wire
// language packs (loadLanguage), validators (linter → ValidationGutter),
// and per-format extras (loadExtraExtensions).

import { useCallback, useEffect, useRef } from "react";
import {
  Compartment,
  EditorState,
  Transaction,
} from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { detectSourceLanguage } from "@/lib/formats/sourceLanguage";
// Side-effect import: ships the `.cm-hl-*` color rules (scoped to
// `.source-editor`/`.source-pane`) used by the shared source theme.
import "@/plugins/codemirror/source-syntax.css";
import { buildSourcePaneExtensions } from "./sourcePaneExtensions";
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
  // Line-number gutter lives in its own compartment so the View-menu toggle
  // (Alt+Mod+L / uiStore.showLineNumbers) reconfigures it in place without
  // tearing down the editor and losing undo history. Mirrors the markdown
  // Source editor (lineNumbersCompartment in sourceEditorExtensions.ts).
  const lineNumberCompartmentRef = useRef(new Compartment());
  // Subscribe so a toggle re-renders this component and the effect below
  // reconfigures the gutter compartment (which alone controls visibility —
  // no CSS class is needed since the extension is added/removed in place).
  const showLineNumbers = useUIStore((state) => state.showLineNumbers);
  // Track the doc string we last *wrote* via a transaction so we can
  // skip echoing the store update back into the view (which would
  // collapse the cursor and reset undo position).
  const lastSyncedRef = useRef<string>("");

  // Hold the diagnostics callback in a ref so it doesn't show up as a
  // mount-effect dependency. Parent code commonly passes inline (non-
  // memoized) handlers — without this indirection every parent re-render
  // would tear down and rebuild the CodeMirror view, blowing away undo
  // history and the user's selection. (Audit finding H3.)
  const onDiagnosticsRef = useRef(onDiagnostics);
  // Synced after commit (read only from the CodeMirror diagnostics callback). #1063
  useEffect(() => {
    onDiagnosticsRef.current = onDiagnostics;
  });

  // Stable jump-to-position handle, safe to re-emit whenever the parent's
  // callback prop changes identity. Lives outside the mount effect so a
  // late or swapped `onJumpHandleReady` still receives the handle (audit
  // Round A H1). Reading `viewRef.current` defers binding until the view
  // exists, so calls before mount no-op cleanly.
  const jumpTo = useCallback((line: number, column: number) => {
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
  }, []);

  useEffect(() => {
    onJumpHandleReady?.(jumpTo);
  }, [onJumpHandleReady, jumpTo]);

  /* v8 ignore next -- @preserve documentStore selector path; smoke-tested via mocked store */
  const docSnapshot = useDocumentStore((state) => state.documents?.[tabId] ?? null);
  const storeContent = docSnapshot?.content ?? "";
  const readOnly =
    (docSnapshot?.readOnly ?? false) ||
    (formatConfig.adapters.readOnlyDefault && !editingEnabled);
  const validator = formatConfig.validator;
  const filePath = docSnapshot?.filePath ?? null;
  // A format may ship its own language pack (json/yaml/code viewers). When
  // it doesn't (plain text), fall back to filename-based highlighting so a
  // `.env` / `Dockerfile` / `.sh` opened as plain text still gets colors.
  // Routing already decided this is a source pane — highlighting only picks
  // a language; it can never re-route a file to the markdown editor. The
  // returned loaders are stable module references, so this is dep-safe.
  const loadLanguage =
    formatConfig.loadLanguage ?? detectSourceLanguage(filePath) ?? undefined;

  // One-time mount per (tabId, formatId, readOnly). Document persistence
  // wires via the documentStore.setContent action on every doc change.
  useEffect(() => {
    /* v8 ignore next -- @preserve null-host fallback for jsdom edges */
    if (!containerRef.current) return undefined;

    // Clear stale diagnostics whenever the active format has no validator
    // (e.g. switching from json → txt). Without this, the preview pane's
    // "fix syntax errors" indicator would survive from the previous format
    // since the validator-backed linter is the only thing that calls
    // `onDiagnostics`. (Audit finding H4.)
    if (!validator) onDiagnosticsRef.current?.([]);

    const persistOnUpdate = EditorView.updateListener.of((update) => {
      /* v8 ignore next -- @preserve no-op for non-doc updates */
      if (!update.docChanged) return;
      const next = update.state.doc.toString();
      lastSyncedRef.current = next;
      useDocumentStore.getState().setContent(tabId, next);
    });

    // WI-2.4 — the validator-backed lint gutter and the rest of the base
    // extension list are assembled by the pure builder; the linter hoists
    // diagnostics via onDiagnostics so the preview pane can surface
    // "fix syntax errors at line:column". Reading the callback through the ref
    // keeps a non-memoized parent handler from forcing a remount.
    const baseExtensions = buildSourcePaneExtensions({
      tabId,
      readOnly,
      validator,
      lineNumberCompartment: lineNumberCompartmentRef.current,
      languageCompartment: languageCompartmentRef.current,
      persistOnUpdate,
      onDiagnostics: (diagnostics) => onDiagnosticsRef.current?.(diagnostics),
    });

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

    // Jump-handle emit moved out of the mount effect — see the separate
    // `useEffect` below that re-emits whenever `onJumpHandleReady` changes
    // identity (audit Round A H1).

    let cancelled = false;
    if (loadLanguage) {
      void loadLanguage()
        .then((lang) => {
          /* v8 ignore next -- @preserve unmount race */
          if (cancelled || !viewRef.current) return;
          viewRef.current.dispatch({
            effects: languageCompartmentRef.current.reconfigure(lang),
          });
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

    // Callbacks read via refs (see H3 comment above) are intentionally excluded
    // from this dep array so the editor doesn't remount on every parent render.
  }, [tabId, formatId, readOnly, validator, loadLanguage]);

  // Reconfigure the line-number gutter when the toggle flips. Kept out of
  // the mount effect so toggling never tears down the view (preserves undo
  // history, selection, and scroll position).
  useEffect(() => {
    const view = viewRef.current;
    /* v8 ignore next -- @preserve unmounted-view fallback */
    if (!view) return;
    view.dispatch({
      effects: lineNumberCompartmentRef.current.reconfigure(
        showLineNumbers ? lineNumbers() : [],
      ),
    });
  }, [showLineNumbers]);

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
      data-language-loader={loadLanguage ? "lazy" : "none"}
    >
      <div
        ref={containerRef}
        className="source-pane__editor"
        aria-readonly={readOnly}
      />
    </div>
  );
}
