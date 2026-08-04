/**
 * GhaWorkflowSchemaRenderer — the yaml adapter's `gha-workflow` preview.
 *
 * Purpose: parse a workflow file into the IR and mount the workbench
 *   (@xyflow/react canvas + structured forms editor + save pipeline). When the
 *   parse fails, fall back to a diagnostic line so the user still sees where
 *   the syntax broke.
 *
 *   Split out of `yaml.tsx` by WI-13. The yaml adapter is ALWAYS registered —
 *   the GHA workflow viewer shipped on by default — so `bootstrapFormats()`
 *   dragged the workbench and the workflow IR parser onto the cold start of
 *   every window, including the ones that never open a document. This module
 *   is reached only through `React.lazy` from the adapter now.
 *
 * Key decisions:
 *   - Named export only; the adapter maps it to `{ default }` at the import
 *     site, the convention every other lazy boundary here uses.
 *   - The IR arrives from this component's own parse, not the workflowStore
 *     `gha` slice, so preview-only view mode (source pane unmounted, and with
 *     it the slice's writer) still renders.
 *
 * @coordinates-with lib/formats/adapters/yaml.tsx — sole mount, behind Suspense
 * @coordinates-with components/Editor/WorkflowPanel/GhaWorkflowWorkbench.tsx
 * @module lib/formats/adapters/yamlWorkflowRenderer
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseWorkflow } from "@/lib/ghaWorkflow/parser";
import { GhaWorkflowWorkbench } from "@/components/Editor/WorkflowPanel/GhaWorkflowWorkbench";
import { getFileName } from "@/utils/pathUtils";
import { errorMessage } from "@/utils/errorMessage";
import type { PreviewRendererProps } from "../types";
import "./json-tree.css";

export function GhaWorkflowSchemaRenderer({
  content,
  path,
  diagnostics,
  tabId,
}: PreviewRendererProps) {
  const { t } = useTranslation("editor");
  const parseResult = useMemo(() => {
    try {
      // Use a cross-platform basename helper — `.split("/")` drops the
      // final segment on Windows paths (`C:\…\workflow.yml`).
      const fileName = path ? getFileName(path) || "workflow.yml" : "workflow.yml";
      const ir = parseWorkflow(content, fileName);
      return { ok: true as const, ir };
    } catch (error) {
      return {
        ok: false as const,
        message: errorMessage(error),
      };
    }
  }, [content, path]);

  if (!parseResult.ok) {
    return (
      <div
        className="json-tree-preview json-tree-preview--invalid"
        data-schema="gha-workflow"
      >
        <span>{t("preview.workflowParseFailed")}</span>
        {diagnostics[0] && (
          <span className="json-tree-preview__hint">
            {" "}
            {t("preview.errorAt", {
              line: diagnostics[0].line,
              column: diagnostics[0].column,
            })}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="yaml-workflow-preview" data-schema="gha-workflow">
      <GhaWorkflowWorkbench workflow={parseResult.ir} tabId={tabId ?? null} />
    </div>
  );
}
