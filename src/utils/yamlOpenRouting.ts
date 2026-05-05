/**
 * Purpose: Single source of truth for routing `.yml`/`.yaml` workflow
 *   files to source mode at open time. Without this, opening a YAML
 *   file via Recent Files / Finder / drag-drop / new-tab routes the
 *   content through Tiptap's WYSIWYG markdown round-trip — which
 *   silently corrupts YAML indentation (turning `  - uses: x@v4` into
 *   `\- uses: x\@v4` and stripping nested-key whitespace) before the
 *   source editor ever sees the file.
 *
 *   The fix is structural: marking the tab as forced-source BEFORE
 *   `initDocument` keeps the WYSIWYG editor from mounting against
 *   that document at all, so the original bytes flow straight into
 *   CodeMirror.
 *
 * Plan: dev-docs/plans/20260504-github-actions-workflow-viewer.md —
 *   Tauri-MCP smoke (Phase 9 follow-up) discovered this bug.
 *
 * @coordinates-with src/stores/largeFileSessionStore.ts — markForcedSource sink
 * @coordinates-with src/utils/dropPaths.ts — isYamlFileName predicate
 * @coordinates-with src/utils/workflowFeatureFlag.ts — gating flag
 * @module utils/yamlOpenRouting
 */

import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { isYamlFileName } from "@/utils/dropPaths";
import { isWorkflowEnabled } from "@/utils/workflowFeatureFlag";

/**
 * Mark a tab as forced-source if the file path looks like a YAML
 * workflow and the workflow engine is enabled. Call BEFORE
 * `documentStore.initDocument(tabId, content, path)` so the WYSIWYG
 * editor never mounts against the document. No-op for non-YAML files
 * and when the feature flag is off.
 *
 * Idempotent: multiple calls for the same tabId set the same flag.
 */
export function maybeForceSourceForYaml(tabId: string, path: string): void {
  const fileName = path.split("/").pop() ?? "";
  if (!isWorkflowEnabled()) return;
  if (!isYamlFileName(fileName)) return;
  useLargeFileSessionStore.getState().markForcedSource(tabId);
}
