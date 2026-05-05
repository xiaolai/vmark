/**
 * Purpose: GHA-specific mount of the WorkflowPanelShell. Receives the
 *   parsed WorkflowIR + a host-provided source editor, renders the
 *   source on the left and the interactive canvas on the right.
 *
 * Key decisions:
 *   - Owns no parsing; the host runs `parse()` from
 *     src/lib/ghaWorkflow/parser/index.ts and passes the IR in.
 *   - Source rendering is host-provided so this module doesn't pull
 *     in CodeMirror plumbing — the host integrates the real editor on
 *     mount. This component is the "view" half of the view-controller
 *     pair.
 *
 * Interactive verification: mounting and click-to-jump need to be
 * verified at runtime in the Tauri webview. Compile + unit tests
 * cover what's verifiable headlessly.
 *
 * @module components/Editor/WorkflowPanel/GhaWorkflowPanel
 */

import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowPanelShell } from "./WorkflowPanelShell";

interface GhaWorkflowPanelProps {
  workflow: WorkflowIR;
  /** Source-side editor — host injects CodeMirror or similar. */
  sourceEditor: ReactNode;
}

export function GhaWorkflowPanel(
  props: GhaWorkflowPanelProps,
): ReactElement {
  const { t } = useTranslation("workflowEditor");
  return (
    <WorkflowPanelShell
      ariaLabel={t("panel.viewerAriaLabel")}
      left={props.sourceEditor}
      right={
        <div className="gha-workflow-canvas">
          <WorkflowCanvas workflow={props.workflow} />
        </div>
      }
    />
  );
}
