// WI-1A.4 + WI-1A.10 — SplitPaneEditor.
//
// Mounted by Editor.tsx (after WI-1A.5) for FormatConfig.kind === "split-pane"
// or "viewer". Composes:
//
//   ┌──────────────────────────┬──────────────────────────┐
//   │ SourcePane               │ Preview slot             │
//   │ (CodeMirror — WI-1A.9+)  │ (genericPreview or       │
//   │                          │  schemaRenderers)        │
//   │                          │                          │
//   └──────────────────────────┴──────────────────────────┘
//                              ▲
//                              │
//                          resize handle
//                          (keyboard ArrowLeft/Right)
//
// Skeleton today: validator slot is reserved on FormatConfig but the
// gutter rendering lives inside SourcePane in WI-1A.8. The split fraction
// is held in component state and clamped to [0.2, 0.8].

import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SourcePane } from "./SourcePane";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { ValidationGutter } from "./ValidationGutter";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { imeToast as toast } from "@/utils/imeToast";
import type {
  FormatConfig,
  PreviewRenderer,
  ValidationDiagnostic,
} from "@/lib/formats/types";
import "./split-pane-editor.css";

export interface SplitPaneEditorProps {
  tabId: string;
  formatConfig: FormatConfig;
}

const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.8;
const STEP = 0.05;
const DEFAULT_FRACTION = 0.5;

function clamp(n: number): number {
  if (n < MIN_FRACTION) return MIN_FRACTION;
  if (n > MAX_FRACTION) return MAX_FRACTION;
  return n;
}

export function SplitPaneEditor({ tabId, formatConfig }: SplitPaneEditorProps) {
  const { t } = useTranslation("editor");
  const [fraction, setFraction] = useState(DEFAULT_FRACTION);
  const [diagnostics, setDiagnostics] = useState<ValidationDiagnostic[]>([]);
  // Imperative cursor-jump handle exposed by SourcePane. ValidationGutter
  // row clicks call this to move the editor cursor to (line, column).
  const jumpHandleRef = useRef<((line: number, column: number) => void) | null>(
    null,
  );
  const handleJump = useCallback((line: number, column: number) => {
    jumpHandleRef.current?.(line, column);
  }, []);
  // WI-4.3 — per-tab editing override sourced from tabStore so it
  // survives tab switches. The Tab.editingEnabled flag persists in
  // the store; SplitPaneEditor reads it and dispatches to set it.
  const editingEnabled = useTabStore((s) => {
    const found = s.findTabById?.(tabId) ?? null;
    return Boolean(found?.editingEnabled);
  });

  // WI-2.4 — schema-aware preview dispatch. When the format declares a
  // schemaDetector AND the active document matches a registered
  // schemaRenderer, prefer the schema renderer over the generic preview.
  const content = useDocumentStore(
    (state) => state.documents?.[tabId]?.content ?? "",
  );
  const filePath = useDocumentStore(
    (state) => state.documents?.[tabId]?.filePath ?? null,
  );
  const Preview: PreviewRenderer | undefined = useMemo(() => {
    const detector = formatConfig.schemaDetector;
    const renderers = formatConfig.schemaRenderers;
    if (detector && renderers) {
      try {
        const schemaId = detector(filePath ?? "", content);
        if (schemaId && renderers[schemaId]) {
          return renderers[schemaId];
        }
      } catch {
        /* detector errors fall through to generic preview */
      }
    }
    return formatConfig.genericPreview;
  }, [content, filePath, formatConfig]);
  const hasPreview = Boolean(Preview);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFraction((f) => clamp(f - STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setFraction((f) => clamp(f + STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFraction(MIN_FRACTION);
    } else if (e.key === "End") {
      e.preventDefault();
      setFraction(MAX_FRACTION);
    }
  }, []);

  // WI-4.2 — read-only banner for kind="viewer" tabs. Hidden when the
  // user has clicked "Enable editing" or when the format isn't read-
  // only-default.
  const showReadOnlyBanner =
    formatConfig.kind === "viewer" &&
    formatConfig.adapters.readOnlyDefault &&
    !editingEnabled;

  // WI-4.4 — Open in external editor handler. The Tauri command lives
  // in src-tauri/src/external_editor.rs (added in this phase). It
  // reads $EDITOR (or platform default) and spawns it with the file
  // path. Failure is surfaced via the toast pipeline; we don't block
  // the UI.
  const handleOpenExternal = useCallback(() => {
    if (!filePath) return;
    // Read the GUI-setting at click time (not via selector) so a setting
    // change while a tab is open takes effect immediately.
    const editorOverride =
      useSettingsStore.getState().formats.externalEditor.trim() || null;
    invoke("open_in_external_editor", {
      path: filePath,
      editorOverride,
    }).catch((error: unknown) => {
      // Bubble Rust-side rejections (forbidden override chars, missing
      // editor, spawn failure) to the user instead of silently dropping
      // the unhandled promise rejection.
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    });
  }, [filePath]);

  return (
    <div
      className="split-pane-editor"
      role="group"
      aria-label={t("splitPane.editorLabel", { format: formatConfig.id })}
      data-format-id={formatConfig.id}
      style={
        {
          "--split-pane-source-fraction": String(
            hasPreview ? fraction : 1,
          ),
        } as React.CSSProperties
      }
    >
      {showReadOnlyBanner && (
        <ReadOnlyBanner
          formatNameI18nKey={formatConfig.nameI18nKey}
          onEnableEditing={() =>
            useTabStore.getState().setTabEditingEnabled(tabId, true)
          }
          onOpenExternal={filePath ? handleOpenExternal : undefined}
        />
      )}
      <div className="split-pane-editor__source">
        <SourcePane
          tabId={tabId}
          formatId={formatConfig.id}
          formatConfig={formatConfig}
          onDiagnostics={setDiagnostics}
          onJumpHandleReady={(jump) => {
            jumpHandleRef.current = jump;
          }}
          editingEnabled={editingEnabled}
        />
        {diagnostics.length > 0 && (
          <ValidationGutter diagnostics={diagnostics} onJump={handleJump} />
        )}
      </div>
      {hasPreview && (
        <div
          className="split-pane-editor__resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("splitPane.resize")}
          aria-valuemin={MIN_FRACTION * 100}
          aria-valuemax={MAX_FRACTION * 100}
          aria-valuenow={Math.round(fraction * 100)}
          tabIndex={0}
          onKeyDown={onKeyDown}
        />
      )}
      {hasPreview && Preview && (
        <div className="split-pane-editor__preview">
          <Preview
            content={content}
            path={filePath}
            diagnostics={diagnostics}
          />
        </div>
      )}
    </div>
  );
}

export default SplitPaneEditor;
