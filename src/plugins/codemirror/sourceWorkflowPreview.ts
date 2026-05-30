/**
 * Source Workflow Preview Plugin
 *
 * Purpose: When editing a standalone .yml workflow file in Source mode,
 * debounces YAML parsing and feeds the result to workflowPreviewStore
 * so the WorkflowSidePanel shows a live React Flow graph.
 *
 * @coordinates-with workflowPreviewStore.ts — writes graph/parseError
 * @coordinates-with parser.ts — parseWorkflow, isWorkflowYaml
 * @module plugins/codemirror/sourceWorkflowPreview
 */

import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { useWorkflowStore } from "@/stores/workflowStore";
import { parseWorkflow, isWorkflowYaml, WorkflowParseError, WorkflowValidationError } from "@/lib/workflow/parser";
import { workflowLog, workflowWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

const DEBOUNCE_MS = 300;

class SourceWorkflowPreviewPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContent = "";

  constructor() {
    // Initial parse when plugin mounts
    // (content isn't available in constructor — will parse on first update)
  }

  update(update: ViewUpdate) {
    if (!update.docChanged) return;

    const content = update.state.doc.toString();
    if (content === this.lastContent) return;
    this.lastContent = content;

    // Debounce parsing
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.parseAndUpdate(content);
    }, DEBOUNCE_MS);
  }

  private parseAndUpdate(content: string) {
    if (!isWorkflowYaml(content)) {
      useWorkflowStore.getState().setGraph(null);
      useWorkflowStore.getState().previewClosePanel();
      return;
    }

    try {
      const graph = parseWorkflow(content);
      workflowLog("Parsed workflow:", graph.name, `(${graph.steps.length} steps)`);
      useWorkflowStore.getState().setGraph(graph);
      // Auto-open the panel if a valid workflow is detected
      if (!useWorkflowStore.getState().preview.panelOpen) {
        useWorkflowStore.getState().previewOpenPanel();
      }
    } catch (e) {
      if (e instanceof WorkflowParseError || e instanceof WorkflowValidationError) {
        workflowWarn("Workflow parse error:", e.message);
        useWorkflowStore.getState().setGraph(null, e.message);
      } else {
        workflowWarn("Unexpected parse error:", errorMessage(e));
        useWorkflowStore.getState().setGraph(
          null,
          errorMessage(e),
        );
      }
    }
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // Reset store when leaving the workflow file
    useWorkflowStore.getState().resetPreview();
  }
}

export function createSourceWorkflowPreviewPlugin() {
  return ViewPlugin.fromClass(SourceWorkflowPreviewPlugin);
}

export const sourceWorkflowPreviewExtensions = [createSourceWorkflowPreviewPlugin()];
