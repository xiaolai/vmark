/**
 * Purpose: Keeps a live GitHub-Actions WorkflowIR in sync with the
 *   split-pane source editor. Parses the document — immediately on
 *   mount, debounced on edits — and hands the result to an injected
 *   `publish` hook so the slice's readers (expression completion,
 *   cursor→canvas sync) see a live workflow. Non-workflow YAML
 *   publishes null, clearing any stale IR; destroy() publishes null so
 *   a closed editor leaves nothing behind.
 *
 *   Successor to the retired sourceGhaWorkflowPreview plugin (WI-2.4):
 *   the preview surface moved to the yaml adapter's schemaRenderer,
 *   which parses for its own props, but the store still needs a writer
 *   tied to the source editor's lifecycle — completion and cursor sync
 *   must work even when the preview pane is hidden (source-only mode).
 *
 * Key decisions:
 *   - Store access is injected (GhaIrSyncHooks), not imported — plugins
 *     must stay store-free (lint:store-coupling). The yaml format
 *     adapter binds the hooks to the workflowStore gha slice, keyed by
 *     tab so two split panes cannot clobber each other.
 *   - Detection: a `.github/workflows/` path or a workflow-shaped body
 *     publishes. Deliberately LOOSER than yamlSchemaDetector, which
 *     declines shape-detected content that fails a YAML parse: parse()
 *     is non-throwing and returns a best-effort IR with diagnostics, so
 *     publishing through transient syntax errors keeps completion alive
 *     mid-typing even while the preview falls back to the tree view.
 *
 * @coordinates-with src/lib/formats/adapters/yaml.tsx — binds hooks to the workflowStore gha slice
 * @coordinates-with src/plugins/codemirror/sourceWorkflowCompletion.ts — reader of the published IR
 * @coordinates-with src/plugins/codemirror/sourceWorkflowCursorSync.ts — reader of the published IR
 * @module plugins/codemirror/sourceGhaIrSync
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { parse as parseWorkflow } from "@/lib/ghaWorkflow/parser";
import { getFileName } from "@/utils/pathUtils";

export const GHA_IR_SYNC_DEBOUNCE_MS = 300;

export interface GhaIrSyncHooks {
  /** Current file path of the bound document, read fresh per parse so a
   *  Save As between edits is picked up. */
  getFilePath: () => string | null;
  /** Publish a parse result downstream; null means "no workflow here"
   *  and must clear previously published state. */
  publish: (workflow: WorkflowIR | null) => void;
}

function parseAndPublish(hooks: GhaIrSyncHooks, content: string): void {
  const filePath = hooks.getFilePath();
  if (!looksLikeWorkflowPath(filePath) && !isWorkflowYaml(content)) {
    hooks.publish(null);
    return;
  }
  const fileName = filePath
    ? getFileName(filePath) || "workflow.yml"
    : "workflow.yml";
  try {
    hooks.publish(parseWorkflow(content, fileName));
  } catch {
    /* v8 ignore next 3 -- @preserve parse() is contractually non-throwing; belt-and-braces so an upstream regression degrades to "no workflow" instead of breaking the editor */
    hooks.publish(null);
  }
}

/** Feed a workflow-IR consumer from this editor's document. */
export function ghaIrSyncExtension(hooks: GhaIrSyncHooks): Extension {
  return ViewPlugin.fromClass(
    class {
      private debounceTimer: ReturnType<typeof setTimeout> | null = null;

      constructor(view: EditorView) {
        // Immediate (undebounced) parse on mount so completion and
        // cursor sync work as soon as a workflow file opens, before the
        // first edit.
        parseAndPublish(hooks, view.state.doc.toString());
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        const content = update.state.doc.toString();
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          parseAndPublish(hooks, content);
        }, GHA_IR_SYNC_DEBOUNCE_MS);
      }

      destroy() {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        hooks.publish(null);
      }
    },
  );
}
