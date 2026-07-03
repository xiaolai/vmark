// WI-1A.1 — Format registry types (multi-format rebrand Phase 1A).
//
// Source of truth for FormatConfig, FormatAdapters, ValidationDiagnostic,
// and TabFormatState. Plan reference:
// dev-docs/plans/20260506-multi-format-rebrand.md § Format registry contract.

import type { Extension } from "@codemirror/state";
import type { ComponentType } from "react";

export type FormatKind =
  | "wysiwyg"
  | "split-pane"
  | "viewer"
  // Binary media (image/audio/video). Rendered full-width by a dedicated
  // surface via the asset protocol — no CodeMirror source pane, never read as
  // UTF-8 text, never editable. See dev-docs/plans/20260703-media-viewer.md.
  | "media";

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

export interface FormatAdapters {
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
  closeSavePolicy: "markdown-default" | "save-as-only";
}

export interface FormatConfig {
  id: string;
  nameI18nKey: string;
  extensions: string[];
  kind: FormatKind;
  wysiwygComponent?: ComponentType<{ tabId: string }>;
  loadLanguage?: () => Promise<Extension>;
  loadExtraExtensions?: () => Promise<Extension[]>;
  validator?: Validator;
  genericPreview?: PreviewRenderer;
  schemaDetector?: SchemaDetector;
  schemaRenderers?: Record<string, PreviewRenderer>;
  adapters: FormatAdapters;
}

export interface TabFormatState {
  formatId: string;
  editingEnabled?: boolean;
  activeSchemaId?: string | null;
}
