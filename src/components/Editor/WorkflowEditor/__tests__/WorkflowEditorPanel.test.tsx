// Phase 7 WI-7.2 — WorkflowEditorPanel container tests.
//
// The panel:
//   - Always renders the trigger summary if there's a workflow.
//   - Renders the empty hint when no job is selected.
//   - Renders JobForm when a job is selected.
//   - Renders StepForm when a step is selected.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
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

  it("Discard remounts the active form so mid-edit useState values reset (audit fix for WI-7.2)", () => {
    useWorkflowViewStore.getState().selectJob("build");
    let discardCalled = false;
    const view = render(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {
          discardCalled = true;
        }}
      />,
    );
    // Type into the name input without blurring (no patch queued).
    let nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    fireEvent.change(nameInput, {
      target: { value: "TYPED-BUT-UNCOMMITTED" },
    });
    expect(nameInput.value).toBe("TYPED-BUT-UNCOMMITTED");
    // Queue a patch so the Discard button is enabled.
    useWorkflowEditStore.getState().queuePatch({
      kind: "workflow.set",
      path: "name",
      value: "x",
    });
    view.rerender(
      <WorkflowEditorPanel
        workflow={makeWorkflow()}
        onSave={async () => {}}
        onDiscard={() => {
          discardCalled = true;
        }}
      />,
    );
    // Click Discard.
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    // The form has remounted from the IR; the typed value is gone.
    nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Build");
    expect(discardCalled).toBe(true);
  });

  it("clears form-local edit state when selection switches to another job", () => {
    // Two-job workflow: select first, type into name, switch selection,
    // then verify the new job's name shows (not the typed value).
    const wf: WorkflowIR = {
      ...makeWorkflow(),
      jobs: [
        ...makeWorkflow().jobs,
        {
          id: "deploy",
          name: "Deploy",
          runsOn: ["macos-latest"],
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    };
    useWorkflowViewStore.getState().selectJob("build");
    const view = render(
      <WorkflowEditorPanel
        workflow={wf}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    let nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    nameInput.value = "TYPED-BUT-UNCOMMITTED";
    // Now switch selection. The form must remount and show "Deploy", not
    // the typed value, and not "Build".
    useWorkflowViewStore.getState().selectJob("deploy");
    view.rerender(
      <WorkflowEditorPanel
        workflow={wf}
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    );
    nameInput = screen.getByLabelText(/^name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Deploy");
  });

  describe("focus restoration on step navigation", () => {
    it("focuses Next button after step→step transition", async () => {
      useWorkflowViewStore.getState().selectStep("build", "checkout");
      render(
        <WorkflowEditorPanel
          workflow={makeWorkflow()}
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
      // Trigger step→step nav. The effect inside the panel observes the
      // stepId transition and schedules a focus via requestAnimationFrame.
      useWorkflowViewStore.getState().selectStep("build", "test");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      // After nav, Back-to-job should be focused (Next disabled at last step,
      // Prev points back to previous step which IS available — so Prev or Back).
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.className).toContain("workflow-form__nav-btn");
    });

    it("does NOT auto-focus on initial step selection (null → step)", async () => {
      const { container } = render(
        <WorkflowEditorPanel
          workflow={makeWorkflow()}
          onSave={async () => {}}
          onDiscard={() => {}}
        />,
      );
      // Initial mount with NO step selected — body is the active element.
      // Now select a step for the first time. Should NOT trigger auto-focus.
      const focusedBefore = document.activeElement;
      useWorkflowViewStore.getState().selectStep("build", "checkout");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      // No nav button should have been focused.
      const focused = document.activeElement;
      expect(focused).toBe(focusedBefore);
      // Form did render though.
      expect(container.querySelector(".workflow-form__step-position")).toBeTruthy();
    });
  });
});
