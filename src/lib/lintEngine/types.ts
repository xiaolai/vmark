/**
 * Markdown Lint Engine — Type Definitions
 *
 * Purpose: Shared types for the lint engine, rules, and UI integration.
 */

/**
 * How the diagnostic should render in WYSIWYG mode.
 * - "exact": position maps reliably (headings, images, links)
 * - "block": gutter dot on containing block, no inline highlight
 * - "sourceOnly": cannot show in WYSIWYG; F2 switches to Source mode
 */
type UiHint = "exact" | "block" | "sourceOnly";

type LintSeverity = "error" | "warning";

export interface LintDiagnostic {
  /** Unique ID: `${ruleId}-${line}-${column}` */
  id: string;
  /** Rule identifier: "E01", "W03", etc. */
  ruleId: string;
  severity: LintSeverity;
  /** i18n message key: "lint.E01" */
  messageKey: string;
  /** Interpolation params for the message key */
  messageParams: Record<string, string>;
  /** 1-based line number in source markdown */
  line: number;
  /** 1-based column in source markdown */
  column: number;
  /** 0-based character offset in source */
  offset: number;
  /** End of affected range (0-based). Undefined = point diagnostic. */
  endOffset?: number;
  /** Rendering hint for WYSIWYG mode */
  uiHint: UiHint;
}

/**
 * Pre-computed line index shared across rules (O6 / WI-2.5). The orchestrator
 * splits the source into lines and computes each line's absolute start offset
 * exactly once, instead of every line-oriented rule re-splitting the source
 * (~7×/pass) and `noUndefinedRefs` recomputing offsets in O(L²).
 */
export interface LintLineIndex {
  /** Source split on "\n" once (no trailing newline retained in entries). */
  lines: string[];
  /** Absolute start offset of each line: `lineOffsets[i]` = offset of `lines[i]`. */
  lineOffsets: number[];
}

/**
 * A lint rule function. Receives the raw source text, the parsed MDAST root,
 * and the shared per-pass line index. Returns the diagnostics it found.
 * Rules that only need the MDAST may omit the later parameters.
 */
export type LintRule = (
  source: string,
  mdast: import("mdast").Root,
  index: LintLineIndex
) => LintDiagnostic[];

/** Helper to create a diagnostic with auto-generated id. */
export function createDiagnostic(
  fields: Omit<LintDiagnostic, "id">
): LintDiagnostic {
  return {
    ...fields,
    id: `${fields.ruleId}-${fields.line}-${fields.column}`,
  };
}
