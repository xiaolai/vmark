// WI-1A.1 — Format registry types (multi-format rebrand Phase 1A).
//
// Source of truth for FormatConfig, FormatAdapters, ValidationDiagnostic,
// and TabFormatState. Plan reference:
// dev-docs/plans/20260506-multi-format-rebrand.md § Format registry contract.

import type { Extension } from "@codemirror/state";
import type { ComponentType } from "react";

type FormatKind =
  | "wysiwyg"
  | "split-pane"
  | "viewer"
  // Binary media (image/audio/video). Rendered full-width by a dedicated
  // surface via the asset protocol — no CodeMirror source pane, never read as
  // UTF-8 text, never editable. See dev-docs/plans/20260703-media-viewer.md.
  | "media";

/**
 * Per-tab view mode for split-pane / viewer formats (HTML, SVG, Mermaid, …).
 *
 * - `source`  — CodeMirror source pane full-width (preview unmounted).
 * - `split`   — source ▏preview side by side (the default).
 * - `preview` — read-only render full-width (source pane unmounted).
 *
 * Only meaningful when the format actually declares a preview; formats without
 * one always render source-only regardless of this value. See
 * dev-docs/plans/20260703-split-pane-view-modes.md.
 */
export type SplitViewMode = "source" | "split" | "preview";

/** Runtime guard — true for a valid SplitViewMode. Guards against corrupt
 *  persisted settings producing an out-of-range mode. */
export function isSplitViewMode(value: unknown): value is SplitViewMode {
  return value === "source" || value === "split" || value === "preview";
}

export interface ValidationDiagnostic {
  severity: "error" | "warning" | "info";
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId?: string;
  sourceUrl?: string;
}

export type Validator = (
  content: string,
  path?: string,
) => ValidationDiagnostic[];

export type SchemaDetector = (path: string, content: string) => string | null;

export interface PreviewRendererProps {
  content: string;
  path: string | null;
  diagnostics: ValidationDiagnostic[];
  onJumpToPosition?: (line: number, column: number) => void;
}
export type PreviewRenderer = ComponentType<PreviewRendererProps>;

interface FormatAdapters {
  saveDialogFilters: { name: string; extensions: string[] }[];
  untitledExtension: string;
  exportEnabled?: boolean;
  findEnabled?: boolean;
  contentSearchIndexed?: boolean;
  readOnlyDefault: boolean;
  reloadPolicy?: "reload" | "prompt";
  sidePanelComponent?: ComponentType<{ tabId: string }>;
  sidePanelKeepAlive?:
    | "while-active"
    | "always-when-registered"
    | "lazy-on-demand";
  menuPolicy: {
    sourceWysiwygToggle: boolean;
    cjkFormatActions: boolean;
    insertBlockActions: boolean;
    paragraphFormatting: boolean;
  };
  /**
   * What closing a dirty tab does.
   *
   * `prompt-on-close` was named `markdown-default` — a format's own name inside
   * a format-neutral contract, which every adapter had to set including `txt`
   * and the read-only code viewers. The value describes a BEHAVIOUR, not a
   * format (ADR-015 Phase 4B, WI-4.2).
   */
  closeSavePolicy: "prompt-on-close" | "save-as-only";
}

export interface FormatConfig {
  id: string;
  nameI18nKey: string;
  extensions: string[];
  kind: FormatKind;
  wysiwygComponent?: ComponentType<{ tabId: string }>;
  /**
   * Synchronous CodeMirror language, for packs the app bundles anyway.
   *
   * `loadLanguage` is the general path and is async, which means a host must
   * mount with no language and reconfigure a Compartment when the promise
   * resolves. For markdown — the primary format, opened constantly — that would
   * put a frame of unhighlighted text on the most-used path.
   *
   * A format that is statically imported regardless (markdown, yaml) may expose
   * it synchronously here instead. Hosts prefer `language` when present and fall
   * back to `loadLanguage`, so one host serves every format without the common
   * case paying for the general one. ADR-015 Phase 4A, option 2.
   */
  language?: () => Extension;
  loadLanguage?: () => Promise<Extension>;
  loadExtraExtensions?: () => Promise<Extension[]>;
  validator?: Validator;
  genericPreview?: PreviewRenderer;
  schemaDetector?: SchemaDetector;
  schemaRenderers?: Record<string, PreviewRenderer>;
  adapters: FormatAdapters;
}
