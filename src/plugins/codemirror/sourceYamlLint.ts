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
import { collectYamlParseErrors } from "@/lib/yamlValidation/parseErrors";

/**
 * Run the yaml package's parse + collect any errors and warnings as
 * CodeMirror diagnostics with absolute char offsets in the source.
 *
 * Thin wrapper over the lib-side `collectYamlParseErrors` — kept
 * here for backward-compat (test imports etc.). The lib version
 * is the single source of truth.
 */
export function collectYamlDiagnostics(text: string): Diagnostic[] {
  return collectYamlParseErrors(text);
}

/**
 * Build the lint extension. Re-parses on every input change (cheap
 * for documents under a few MB; the yaml package's parseDocument is
 * already used in the workflow detection path).
 */
export function yamlLintExtension(): Extension {
  return linter((view) => collectYamlDiagnostics(view.state.doc.toString()));
}
