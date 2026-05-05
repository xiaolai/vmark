// Tests for workflowViewStore — Zustand state for the GHA workflow viewer.

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkflowViewStore } from "../workflowViewStore";

describe("workflowViewStore", () => {
  beforeEach(() => {
    useWorkflowViewStore.getState().reset();
  });

  it("starts with no selection", () => {
    const state = useWorkflowViewStore.getState();
    expect(state.selectedJobId).toBeNull();
    expect(state.selectedStepId).toBeNull();
  });

  it("selectJob sets the job and clears the step", () => {
    const { selectJob } = useWorkflowViewStore.getState();
    selectJob("build");
    const s = useWorkflowViewStore.getState();
    expect(s.selectedJobId).toBe("build");
    expect(s.selectedStepId).toBeNull();
  });

  it("selectStep records both job and step ids", () => {
    const { selectStep } = useWorkflowViewStore.getState();
    selectStep("build", "checkout");
    const s = useWorkflowViewStore.getState();
    expect(s.selectedJobId).toBe("build");
    expect(s.selectedStepId).toBe("checkout");
  });

  it("clearSelection resets both ids", () => {
    const { selectStep, clearSelection } = useWorkflowViewStore.getState();
    selectStep("a", "b");
    clearSelection();
    const s = useWorkflowViewStore.getState();
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedStepId).toBeNull();
  });

  it("expanded matrices default to empty set; toggleMatrix flips state", () => {
    const { toggleMatrix } = useWorkflowViewStore.getState();
    expect(useWorkflowViewStore.getState().expandedMatrices.has("build")).toBe(
      false,
    );
    toggleMatrix("build");
    expect(useWorkflowViewStore.getState().expandedMatrices.has("build")).toBe(
      true,
    );
    toggleMatrix("build");
    expect(useWorkflowViewStore.getState().expandedMatrices.has("build")).toBe(
      false,
    );
  });

  it("toggleMatrix is independent per job id", () => {
    const { toggleMatrix } = useWorkflowViewStore.getState();
    toggleMatrix("a");
    toggleMatrix("b");
    const s = useWorkflowViewStore.getState();
    expect(s.expandedMatrices.has("a")).toBe(true);
    expect(s.expandedMatrices.has("b")).toBe(true);
    expect(s.expandedMatrices.has("c")).toBe(false);
  });

  it("layoutDirection defaults to 'TD' and is settable", () => {
    expect(useWorkflowViewStore.getState().layoutDirection).toBe("TD");
    useWorkflowViewStore.getState().setLayoutDirection("LR");
    expect(useWorkflowViewStore.getState().layoutDirection).toBe("LR");
  });

  it("reset returns the store to initial state", () => {
    const { selectStep, toggleMatrix, setLayoutDirection, reset } =
      useWorkflowViewStore.getState();
    selectStep("a", "b");
    toggleMatrix("c");
    setLayoutDirection("LR");
    reset();
    const s = useWorkflowViewStore.getState();
    expect(s.selectedJobId).toBeNull();
    expect(s.selectedStepId).toBeNull();
    expect(s.expandedMatrices.size).toBe(0);
    expect(s.layoutDirection).toBe("TD");
  });
});
