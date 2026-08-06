// WI-1A.1 — Format registry types (multi-format rebrand Phase 1A).
//
// Source of truth for FormatConfig, FormatAdapters, ValidationDiagnostic,
// and TabFormatState. Plan reference:
// dev-docs/plans/20260506-multi-format-rebrand.md § Format registry contract.

import type { Extension } from "@codemirror/state";
import type { LintDiagnostic } from "@/lib/lintEngine";
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

/** One heading in a document outline. `line` is 0-based. */
export interface OutlineHeading {
  level: number;
  text: string;
  line: number;
}

export type SchemaDetector = (path: string, content: string) => string | null;

/**
 * Context handed to `FormatConfig.loadExtraExtensions`. Everything a
 * per-format CodeMirror extension needs to bind itself to the editor it
 * mounts in: the tab (for store reads scoped to this document), the file
 * path at mount time, and the window label (multi-window sessions must
 * not resolve against another window's tabs).
 */
interface SourceExtrasContext {
  tabId: string;
  filePath: string | null;
  windowLabel: string;
}

export interface PreviewRendererProps {
  content: string;
  path: string | null;
  diagnostics: ValidationDiagnostic[];
  /** The hosting tab. Set by SplitPaneEditor so renderers that write
   *  per-document state (the gha workbench's patch-queue binding, save
   *  target) address THEIR pane's tab — never the focused-pane alias,
   *  which diverges under document split. */
  tabId?: string;
  onJumpToPosition?: (line: number, column: number) => void;
}
export type PreviewRenderer = ComponentType<PreviewRendererProps>;

interface FormatAdapters {
  /**
   * Save-dialog filters. `nameI18nKey` is a `common:`-namespaced key resolved
   * at DIALOG time by `resolveSaveFilters` — a literal name here would be
   * frozen in English at module-load time, which is how "Markdown" reached
   * three call sites untranslated.
   */
  saveDialogFilters: { nameI18nKey: string; extensions: string[] }[];
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
  /**
   * The WYSIWYG editing surface, as an IMPORT THUNK (WI-13).
   *
   * `bootstrapFormats()` runs in every window — Settings, PDF export — before
   * `import("./App")`, so a direct `ComponentType` reference here (the shape
   * before WI-13) meant every window statically imported the Tiptap surface at
   * cold start whether or not it would ever show an editor. The registry now
   * registers METADATA eagerly and loads the surface at first mount, through
   * `resolveFormatSurface` (`lib/formats/lazySurfaces.ts`), which owns caching
   * and the D4 failure semantics.
   *
   * Shape is `{ default }` so the value drops straight into `React.lazy`.
   */
  wysiwygComponent?: () => Promise<{
    default: ComponentType<{ tabId: string }>;
  }>;
  /**
   * The format's CodeMirror language pack, as an import thunk.
   *
   * Was `() => Extension` — synchronous, on the argument that markdown's pack
   * is "bundled regardless" so the primary format's source mode never mounts
   * unhighlighted. WI-13 removed the premise: it was bundled regardless
   * BECAUSE this field forced a static import from the adapter, and that
   * import is exactly what put ~1.6 MB of CodeMirror on the cold start of
   * windows with no editor in them.
   *
   * The unhighlighted-frame concern is still handled, one layer down: the
   * source editor mounts its statically-imported markdown pack into a
   * Compartment and reconfigures when this thunk resolves, so the primary
   * format sees the same first frame it always did.
   *
   * Distinct from `loadLanguage` only by kind: `wysiwyg` formats may not
   * declare `loadLanguage` (see registerFormat), so this is the field a
   * WYSIWYG format's source mode uses.
   */
  language?: () => Promise<Extension>;
  loadLanguage?: () => Promise<Extension>;
  /**
   * Per-format CodeMirror extensions for the split-pane SourcePane,
   * loaded async after mount and swapped in via a compartment (same
   * lifecycle as `loadLanguage`). This is how a format contributes
   * editor behavior beyond highlighting — e.g. yaml supplies the GHA
   * workflow extensions (IR sync into the workflowStore `gha` slice,
   * `${{ }}` expression completion, cursor→canvas sync, goto-def).
   */
  loadExtraExtensions?: (ctx: SourceExtrasContext) => Promise<Extension[]>;
  /**
   * The format's linter, contributed rather than hard-coded.
   *
   * `useLintStore` previously carried a two-format branch — a `runLint` action
   * wired to `lintMarkdown` and a `runYamlLint` action wired to `lintYaml` —
   * so adding a third linted format meant editing the store. A format now
   * supplies its own (ADR-015 Phase 4B, WI-4.3).
   *
   * Distinct from `validator`: that produces `ValidationDiagnostic[]` for the
   * split-pane gutter, this produces the richer `LintDiagnostic[]` the lint
   * panel and source-mode annotations consume.
   */
  lint?: (source: string) => LintDiagnostic[];
  /**
   * Document outline, contributed by the format (WI-4.4).
   *
   * `extractHeadings` is a markdown ATX scanner with fence handling, and it ran
   * for EVERY format — a YAML or JSON tab was scanned for `#` headings. A format
   * that has no outline simply omits this and gets an empty one.
   */
  outline?: (content: string) => OutlineHeading[];

  /**
   * Plain-text projection for status-bar word/character counts (WI-4.4).
   *
   * `stripMarkdown` runs 13 markdown regexes and ran for every format, so a
   * `.json` tab paid markdown's cost and had its braces treated as syntax.
   * Omitting this means the raw content is counted, which is correct for
   * plain-text-ish formats.
   */
  toPlainText?: (content: string) => string;

  validator?: Validator;
  genericPreview?: PreviewRenderer;
  schemaDetector?: SchemaDetector;
  schemaRenderers?: Record<string, PreviewRenderer>;
  adapters: FormatAdapters;
}
