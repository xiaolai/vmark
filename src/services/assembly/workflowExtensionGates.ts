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
 *                Unconditional for YAML since D6 (WI-FL2.6): the viewer has no
 *                flag. Still its own family because the composition wires
 *                three extensions off it and the engine beside it stays gated.
 *   - `engine` — the bespoke execution engine's live preview parse, behind
 *                `advanced.workflowEngine` — the one gate left.
 *
 * @coordinates-with services/assembly/sourceEditorExtensions.ts — the sole caller
 * @coordinates-with services/featureFlags/workflowFeatureFlag.ts — the engine flag
 * @module services/assembly/workflowExtensionGates
 */

import { isYamlFileName } from "@/utils/dropPaths";
import { isWorkflowEngineEnabled } from "@/services/featureFlags/workflowFeatureFlag";

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
    viewer: yaml,
    engine: yaml && isWorkflowEngineEnabled(),
  };
}
