// Phase 7 WI-7.2 — WorkflowEditorPanel container tests.
//
// The panel:
//   - Always renders the trigger summary if there's a workflow.
//   - Renders the empty hint when no job is selected.
//   - Renders JobForm when a job is selected.
//   - Renders StepForm when a step is selected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { useWorkflowViewStore } from "@/stores/workflowViewStore";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { WorkflowEditorPanel } from "../WorkflowEditorPanel";

function makeWorkflow(): WorkflowIR {
  return {
    triggers: [
      {
        event: "push",
        branches: ["main"],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    permissions: "read-all",
    env: {},
    jobs: [
      {
        id: "build",
        name: "Build",
        runsOn: ["ubuntu-latest"],
        needs: [],
        steps: [
          {
            id: "checkout",
            idSynthesized: false,
            uses: "actions/checkout@v4",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
          {
            id: "test",
            idSynthesized: false,
            run: "pnpm test",
            position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          },
        ],
        position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
    ],
    positions: {},
    diagnostics: [],
  };
}

beforeEach(() => {
  useWorkflowViewStore.getState().reset();
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("WorkflowEditorPanel", () => {
  it("renders the trigger summary when no job is selected", () => {
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText("push")).toBeDefined();
    // Empty-job hint should be visible.
    expect(screen.getByText(/select a job/i)).toBeDefined();
  });

  it("renders the JobForm for the selected job", () => {
    useWorkflowViewStore.getState().selectJob("build");
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Build");
  });

  it("renders the StepForm for the selected step", () => {
    useWorkflowViewStore.getState().selectStep("build", "test");
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const runInput = screen.getByLabelText(/^run/i) as HTMLTextAreaElement;
    expect(runInput.value).toBe("pnpm test");
  });

  it("Save button is disabled when there are no pending edits", () => {
    render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    const save = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("renders nothing when workflow is null", () => {
    const { container } = render(
      <WorkflowEditorPanel
        workflow={null}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
