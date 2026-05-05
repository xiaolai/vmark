/**
 * Purpose: Adapt YAML parse errors/warnings into the same
 *   `LintDiagnostic[]` shape used by the markdown lint engine, so
 *   the badge, F2 navigation, and any other lintStore-driven UI
 *   surface YAML problems alongside markdown ones.
 *
 *   Codex audit MED-3 close-out (originally deferred): the
 *   `sourceYamlLint.ts` CodeMirror extension provides live gutter
 *   feedback as the user types, but its diagnostics never reached
 *   the shared lintStore. This module bridges the two, REUSING the
 *   parse logic in `collectYamlDiagnostics`.
 *
 *   Rule IDs:
 *     - Y001 — YAML parse error
 *     - Y002 — YAML parse warning
 *
 * @coordinates-with src/plugins/codemirror/sourceYamlLint.ts — the
 *   live gutter linter (different lifecycle, same parse function).
 * @coordinates-with src/stores/lintStore.ts — runYamlLint action
 * @module lib/lintEngine/yaml
 */

import { collectYamlParseErrors } from "@/lib/yamlValidation/parseErrors";
import { createDiagnostic, type LintDiagnostic } from "./types";

/**
 * Convert YAML parse output into LintDiagnostic[]. Each diagnostic
 * gets a Y001 (error) or Y002 (warning) ruleId, an offset->line/col
 * conversion, and the i18n key for the user message.
 */
export function lintYaml(source: string): LintDiagnostic[] {
  if (!source) return [];
  const cmDiags = collectYamlParseErrors(source);
  if (cmDiags.length === 0) return [];

  return cmDiags.map((cd) => {
    const { line, column } = offsetToLineCol(source, cd.from);
    const ruleId = cd.severity === "error" ? "Y001" : "Y002";
    return createDiagnostic({
      ruleId,
      severity: cd.severity === "error" ? "error" : "warning",
      messageKey:
        cd.severity === "error" ? "lint.yamlParseError" : "lint.yamlParseWarning",
      messageParams: { message: cd.message },
      line,
      column,
      offset: cd.from,
      endOffset: cd.to,
      // YAML files don't render in WYSIWYG, so no decoration there.
      uiHint: "sourceOnly",
    });
  });
}

/** Convert a 0-based char offset to 1-based (line, column). */
function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
