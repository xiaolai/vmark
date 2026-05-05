/**
 * Purpose: CodeMirror extension that surfaces YAML parse-level errors
 *   (duplicate keys, unterminated strings, indentation breaks, invalid
 *   types) for any YAML file — workflow or otherwise.
 *
 *   Workflow files ALSO get this in addition to the existing
 *   schema/actionlint pipeline; non-workflow YAML files get this as
 *   their only diagnostic source. Pure parse-level checks — no
 *   schema validation, no opinionated style rules.
 *
 *   Uses the `yaml` package's `Document.errors` and `.warnings`
 *   arrays. The package already runs in VMark for workflow detection,
 *   so this adds zero new dependencies.
 *
 * @coordinates-with src/utils/sourceEditorExtensions.ts — wired for any YAML
 * @module plugins/codemirror/sourceYamlLint
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { parseDocument } from "yaml";

/**
 * Run the yaml package's parse + collect any errors and warnings as
 * CodeMirror diagnostics with absolute char offsets in the source.
 */
export function collectYamlDiagnostics(text: string): Diagnostic[] {
  if (!text) return [];
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text, { keepSourceTokens: true });
  } catch {
    // Catastrophic parse failure — return a single document-wide
    // diagnostic so the user sees something. Rare; the yaml package
    // recovers from most malformations.
    return [
      {
        from: 0,
        to: Math.min(text.length, 1),
        severity: "error",
        message: "YAML parse failed catastrophically",
      },
    ];
  }
  const diags: Diagnostic[] = [];
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

/**
 * Build the lint extension. Re-parses on every input change (cheap
 * for documents under a few MB; the yaml package's parseDocument is
 * already used in the workflow detection path).
 */
export function yamlLintExtension(): Extension {
  return linter((view) => collectYamlDiagnostics(view.state.doc.toString()));
}
