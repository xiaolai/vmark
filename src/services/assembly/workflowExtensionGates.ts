/**
 * Which workflow extension families a source editor gets (WI-19).
 *
 * Purpose: one place decides, so the four workflow extensions in
 * `sourceEditorExtensions.ts` cannot drift apart. Before the flag split they
 * shared a single `isYaml && isWorkflowEnabled()` boolean, which meant enabling
 * GitHub Actions expression completion also armed `sourceWorkflowPreview` — the
 * plugin that parses the bespoke IR and feeds the side panel's Run button.
 *
 *   - `yaml`   — the file is YAML. Unconditional: `lang-yaml` highlighting and
 *                the parse-error gutter apply to every YAML file (MED-2).
 *   - `viewer` — GitHub Actions authoring aids: `${{ }}` completion,
 *                cursor↔canvas sync, `uses:` goto-def. They read; they never run.
 *   - `engine` — the bespoke execution engine's live preview parse.
 *
 * @coordinates-with services/assembly/sourceEditorExtensions.ts — the sole caller
 * @coordinates-with services/featureFlags/workflowFeatureFlag.ts — the flags
 * @module services/assembly/workflowExtensionGates
 */

import { isYamlFileName } from "@/utils/dropPaths";
import {
  isWorkflowEngineEnabled,
  isWorkflowViewerEnabled,
} from "@/services/featureFlags/workflowFeatureFlag";

export interface WorkflowExtensionGates {
  yaml: boolean;
  viewer: boolean;
  engine: boolean;
}

export function workflowExtensionGates(
  filePath: string | null | undefined,
): WorkflowExtensionGates {
  // Split on BOTH separators: a "/"-only split leaves `C:\…\ci.yml` whole and
  // every workflow family silently switches off on Windows.
  const yaml = filePath
    ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
    : false;
  return {
    yaml,
    viewer: yaml && isWorkflowViewerEnabled(),
    engine: yaml && isWorkflowEngineEnabled(),
  };
}
