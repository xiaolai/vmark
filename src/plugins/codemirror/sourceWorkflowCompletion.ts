/**
 * Purpose: CodeMirror autocomplete provider that surfaces GitHub
 *   Actions expression-context completions inside `${{ }}` regions
 *   while editing a workflow YAML file.
 *
 *   Activates only when:
 *     1. The cursor is inside an unclosed/closing `${{ }}` expression
 *     2. The ghaWorkflowPanelStore has a parsed workflow IR (i.e.,
 *        the file is a recognized workflow)
 *
 *   Otherwise returns null and lets other autocomplete sources run.
 *   The pure-logic core is in `lib/ghaWorkflow/completion/expressionCompletion.ts`;
 *   this file owns only the CodeMirror plumbing (CompletionContext →
 *   CompletionResult) and the IR lookup.
 *
 * @coordinates-with src/stores/ghaWorkflowPanelStore.ts — IR source
 * @coordinates-with src/lib/ghaWorkflow/completion/expressionCompletion.ts — logic
 * @module plugins/codemirror/sourceWorkflowCompletion
 */

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";
import {
  completeAtPosition,
  type CompletionItem,
} from "@/lib/ghaWorkflow/completion/expressionCompletion";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";

function toCmCompletion(item: CompletionItem): Completion {
  // Map our internal Category to a CodeMirror "type" for icon coloring.
  let type: string | undefined;
  switch (item.category) {
    case "context":
      type = "namespace";
      break;
    case "github":
      type = "constant";
      break;
    case "identifier":
      type = "variable";
      break;
  }
  return {
    label: item.label,
    detail: item.detail,
    type,
  };
}

/**
 * The raw completion source, exported for unit testing without
 * pulling in the surrounding CodeMirror extension.
 */
export function workflowCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const { workflow } = useGhaWorkflowPanelStore.getState();
  if (!workflow) return null;

  const text = context.state.doc.toString();
  // We don't track active job from the cursor yet — pass null which
  // means workflow-level scope. Step/needs path completions still
  // work because the second-level (steps.<id>) lookup uses ALL job
  // step ids when no active job is given… actually the helper scopes
  // by activeJobId, so we collapse to all step ids across the workflow
  // when none is provided. Worse-but-acceptable trade-off; a future
  // enhancement can compute the cursor's enclosing job via positions.
  const result = completeAtPosition(text, context.pos, workflow, null);
  if (!result) return null;

  // Empty options list: don't show an empty popup.
  if (result.options.length === 0) {
    return null;
  }

  return {
    from: result.from,
    to: result.to,
    options: result.options.map(toCmCompletion),
    // Validate token chars so CM keeps the popup open as the user
    // types more identifier characters; closes on `.` / `}` / space.
    validFor: /^[A-Za-z0-9_]*$/,
  };
}

/**
 * Build the full extension. Wraps the source in `autocompletion()`
 * and includes only this provider so it doesn't accidentally fire
 * for non-workflow YAML.
 */
export function workflowCompletionExtension() {
  return autocompletion({
    override: [workflowCompletionSource],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
  });
}
