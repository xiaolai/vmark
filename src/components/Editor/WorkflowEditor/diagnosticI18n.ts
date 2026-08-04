/**
 * Diagnostic message translation (audit 20260612 H18).
 *
 * Purpose: Resolve a workflow Diagnostic to a localized message via its
 *   stable code (`workflowEditor:diagnostics.<code>`), interpolating the
 *   diagnostic's `context` map. The English `message` the parser built is
 *   the defaultValue, and also the fallback whenever the localized template
 *   needs placeholders the diagnostic didn't carry — a literal `{{jobId}}`
 *   on screen would be worse than English.
 *
 * @coordinates-with lib/ghaWorkflow/types.ts — Diagnostic.code/context
 * @module components/Editor/WorkflowEditor/diagnosticI18n
 */

import type { TFunction } from "i18next";

import type { Diagnostic } from "@/lib/ghaWorkflow/types";

/** The real `t` for this namespace — see toolbarI18n.ts for why it is not hand-rolled. */
type TranslateFn = TFunction<"workflowEditor">;

/** Unfilled i18next placeholder, e.g. `{{jobId}}`. */
const UNFILLED_PLACEHOLDER = /\{\{\s*\w+\s*\}\}/;

/** Localized message for a diagnostic, falling back to its English text. */
export function diagnosticMessage(t: TranslateFn, diag: Diagnostic): string {
  const translated = t(`diagnostics.${diag.code}`, {
    defaultValue: diag.message,
    ...diag.context,
  });
  return UNFILLED_PLACEHOLDER.test(translated) ? diag.message : translated;
}
