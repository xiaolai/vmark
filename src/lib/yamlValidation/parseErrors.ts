/**
 * Purpose: Pure-logic core for YAML parse-error collection. Wraps
 *   the `yaml` package's parseDocument and returns a normalized
 *   error/warning array (severity, char offsets, message). Used by:
 *     - src/plugins/codemirror/sourceYamlLint.ts — live CM gutter
 *     - src/lib/lintEngine/yaml.ts — adapter to the shared lintStore
 *
 *   Kept in lib/ so consumers don't cross plugin/lib dep boundaries.
 *
 * @module lib/yamlValidation/parseErrors
 */

import { parseDocument } from "yaml";

export interface YamlParseDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
}

export function collectYamlParseErrors(text: string): YamlParseDiagnostic[] {
  if (!text) return [];
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, { keepSourceTokens: true });
  } catch {
    return [
      {
        from: 0,
        to: Math.min(text.length, 1),
        severity: "error",
        message: "YAML parse failed catastrophically",
      },
    ];
  }
  const diags: YamlParseDiagnostic[] = [];
  for (const e of doc.errors) {
    const [from, to] = e.pos ?? [0, Math.min(text.length, 1)];
    diags.push({
      from: Math.max(0, Math.min(from, text.length)),
      to: Math.max(0, Math.min(to, text.length)),
      severity: "error",
      message: e.message,
    });
  }
  for (const w of doc.warnings) {
    const [from, to] = w.pos ?? [0, Math.min(text.length, 1)];
    diags.push({
      from: Math.max(0, Math.min(from, text.length)),
      to: Math.max(0, Math.min(to, text.length)),
      severity: "warning",
      message: w.message,
    });
  }
  return diags;
}
