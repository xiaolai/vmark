// Tests for ghaWorkflowPanelStore — Zustand state for the GHA workflow side panel.

import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { useGhaWorkflowPanelStore } from "../ghaWorkflowPanelStore";

const sampleIr = (): WorkflowIR => ({
  triggers: [],
  permissions: {},
  env: {},
  jobs: [
    {
      id: "build",
      needs: [],
      steps: [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
  ],
  positions: {},
  diagnostics: [],
});

describe("useGhaWorkflowPanelStore", () => {
  beforeEach(() => {
    useGhaWorkflowPanelStore.getState().reset();
  });

  it("starts closed with no IR", () => {
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.panelOpen).toBe(false);
    expect(s.workflow).toBeNull();
    expect(s.parseError).toBeNull();
  });

  it("openPanel / closePanel / togglePanel update panelOpen", () => {
    const { openPanel, closePanel, togglePanel } =
      useGhaWorkflowPanelStore.getState();
    openPanel();
    expect(useGhaWorkflowPanelStore.getState().panelOpen).toBe(true);
    closePanel();
    expect(useGhaWorkflowPanelStore.getState().panelOpen).toBe(false);
    togglePanel();
    expect(useGhaWorkflowPanelStore.getState().panelOpen).toBe(true);
  });

  it("setWorkflow stores the IR and clears the error", () => {
    const ir = sampleIr();
    useGhaWorkflowPanelStore.getState().setWorkflow(ir);
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.workflow).toBe(ir);
    expect(s.parseError).toBeNull();
  });

  it("setWorkflow with error clears the IR and stores the error message", () => {
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    useGhaWorkflowPanelStore.getState().setWorkflow(null, "Parse failed");
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.workflow).toBeNull();
    expect(s.parseError).toBe("Parse failed");
  });

  it("reset returns to initial state", () => {
    const { setWorkflow, openPanel, reset } =
      useGhaWorkflowPanelStore.getState();
    openPanel();
    setWorkflow(sampleIr());
    reset();
    const s = useGhaWorkflowPanelStore.getState();
    expect(s.panelOpen).toBe(false);
    expect(s.workflow).toBeNull();
    expect(s.parseError).toBeNull();
  });
});
