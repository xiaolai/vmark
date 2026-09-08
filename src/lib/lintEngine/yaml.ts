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
 *   parse logic in `collectYamlParseErrors`.
 *
 *   Rule IDs:
 *     - Y001 — YAML parse error
 *     - Y002 — YAML parse warning
 *
 * Offsets are converted through a line-start index built ONCE per call
 * (audit R3 #865): the previous converter walked the source from character
 * zero for every diagnostic, which is O(source × diagnostics) on an
 * editor-facing path that runs as the user types.
 *
 * The index breaks on LF, CRLF **and bare CR** (#866). The mechanism that
 * decides this is the consumer, not the YAML spec: these line numbers address
 * the CodeMirror document, and CodeMirror's `Text` splits on `/\r\n?|\n/` —
 * `"a\rb"` is two lines there. `yaml`'s own message text says "line 1" for the
 * same offset because YAML 1.2 does not call a lone CR a break, but a lint
 * diagnostic that names a line the editor does not have cannot be navigated to.
 * Character offsets are unaffected either way, and they are what
 * `diagnosticToCM` actually ranges on.
 *
 * @coordinates-with src/plugins/codemirror/sourceYamlLint.ts — the
 *   live gutter linter (different lifecycle, same parse function).
 * @coordinates-with src/lib/lintEngine/ruleMeta.ts — Y001 / Y002 severities (#405)
 * @coordinates-with src/stores/documentStore/lint.ts — runYamlLint action
 * @module lib/lintEngine/yaml
 */

import { collectYamlParseErrors } from "@/lib/yamlValidation/parseErrors";
import { createDiagnostic, type LintDiagnostic } from "./types";
import { ruleEmission } from "./ruleMeta";

/**
 * Convert YAML parse output into LintDiagnostic[]. Each diagnostic
 * gets a Y001 (error) or Y002 (warning) ruleId, an offset->line/col
 * conversion, and the i18n key for the user message.
 */
export function lintYaml(source: string): LintDiagnostic[] {
  if (!source) return [];
  const cmDiags = collectYamlParseErrors(source);
  if (cmDiags.length === 0) return [];

  const lineStarts = buildLineStarts(source);

  return cmDiags.map((cd) => {
    const { line, column } = lineColAt(lineStarts, source.length, cd.from);
    return createDiagnostic({
      ...ruleEmission(cd.severity === "error" ? "Y001" : "Y002"),
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

/** Start offset of every line, recognizing LF, CRLF and bare CR breaks. */
function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n") {
      starts.push(i + 1);
    } else if (ch === "\r") {
      if (source[i + 1] === "\n") i += 1; // CRLF is one break
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Convert a 0-based char offset to 1-based (line, column) by binary search
 * over the line-start index. Offsets outside the source clamp into it rather
 * than producing a negative column.
 */
function lineColAt(
  lineStarts: number[],
  sourceLength: number,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.min(Math.max(offset, 0), sourceLength);
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: clamped - lineStarts[lo] + 1 };
}
