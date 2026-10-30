// WI-LX2.1 — a VMark engine workflow opened as a .yml file gets the Run/Cancel panel, behind the engine flag.
/**
 * The finding this closes: the engine's panel mounted only inside the MARKDOWN
 * surface, and `.yml` always routes to the yaml adapter — so with the engine
 * on, no workflow file could ever show Run. The yaml adapter now declares a
 * `vmark-workflow` schema; its renderer is the run panel when the engine is on
 * and the plain YAML tree when it is off.
 *
 * Only the IPC boundary and the React Flow canvas are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/plugins/workflowPreview/WorkflowPreview", () => ({
  WorkflowPreview: ({ graph }: { graph: { steps: unknown[] } }) => (
    <div data-testid="engine-graph">{graph.steps.length} steps</div>
  ),
}));

import { yamlFormat } from "./yaml";
import * as rendererModule from "./yamlEngineRenderer";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import type { PreviewRendererProps } from "../types";

const ENGINE = `name: Triage
steps:
  - id: rewrite
    uses: genie/rewrite-in-english
    with:
      input: hi
  - id: save
    uses: action/save-file
    needs: rewrite
    with:
      path: out.md
      input: done
`;
const initialAdvanced = useSettingsStore.getState().advanced;

function setEngine(on: boolean) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workflowEngine: on },
  });
}

function props(content: string): PreviewRendererProps {
  return { content, liveContent: content, path: "/ws/triage.yml", diagnostics: [], tabId: "tab-1" };
}

function renderSchema(content: string) {
  const Renderer = yamlFormat.schemaRenderers!["vmark-workflow"];
  return render(createElement(Renderer, props(content)));
}

const initialWorkflow = useWorkflowStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: "/ws" } as never);
  useWorkflowStore.setState(initialWorkflow, true);
  invoke.mockReset();
  invoke.mockResolvedValue([]);
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

describe("the vmark-workflow schema renderer", () => {
  it("engine ON: shows the step graph with a Run button", async () => {
    setEngine(true);
    renderSchema(ENGINE);
    expect(await screen.findByTestId("engine-graph", {}, { timeout: 15_000 })).toHaveTextContent(
      "2 steps",
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run workflow" })).toBeEnabled();
  });

  it("engine ON: a workflow that does not validate shows why, and Run stays off", async () => {
    setEngine(true);
    renderSchema("steps:\n  - uses: action/notify\n");
    expect(
      await screen.findByText("Workflow must have a 'name' field", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run workflow" })).toBeDisabled();
  });

  it("engine OFF: the file is plain YAML to VMark — the generic tree, no Run button", async () => {
    setEngine(false);
    const { container } = renderSchema(ENGINE);
    await waitFor(() =>
      expect(container.querySelector('.json-tree-preview[data-format="yaml"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByTestId("engine-graph")).toBeNull();
  });
});

// Audit 20260928 #124 (round 2) — switching the engine off used to unmount
// the Run/Cancel panel at once. The backend is told asynchronously, and if
// that push is lost the run carries on with no control left to stop it. A tab
// whose run is LIVE keeps its panel — and a working Cancel — until the run
// ends, which is also what the backend does on acknowledging the disable.
describe("a live run outlives the panel's reasons to go (#124)", () => {
  const cancelButton = () => screen.findByRole("button", { name: "Cancel workflow" }, { timeout: 15_000 });

  it("engine switched OFF mid-run: the owning tab keeps Cancel, and it still cancels", async () => {
    setEngine(true);
    useWorkflowStore.getState().setExecution("run-1", { tabId: "tab-1", source: ENGINE });
    const { container } = renderSchema(ENGINE);
    await cancelButton();

    act(() => setEngine(false));
    const cancel = await cancelButton();
    expect(cancel).toBeEnabled();
    await userEvent.click(cancel);
    expect(invoke).toHaveBeenCalledWith("cancel_workflow", { executionId: "run-1" });

    // The run ends (the backend cancelled it): now the pane is plain YAML.
    act(() => useWorkflowStore.getState().finishExecution("run-1", "cancelled"));
    await waitFor(() =>
      expect(container.querySelector('.json-tree-preview[data-format="yaml"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Cancel workflow" })).toBeNull();
  });

  it("the owning tab's YAML stops parsing mid-run: the generic preview keeps Cancel", async () => {
    setEngine(true);
    useWorkflowStore.getState().setExecution("run-1", { tabId: "tab-1", source: ENGINE });
    const Generic = yamlFormat.genericPreview!;
    render(createElement(Generic, props("name: [unclosed\nsteps:\n  - uses: action/notify\n")));
    expect(await cancelButton()).toBeEnabled();
  });

  it("a run owned by ANOTHER tab keeps nothing here: engine off is plain YAML", async () => {
    setEngine(false);
    useWorkflowStore.getState().setExecution("run-1", { tabId: "tab-2", source: ENGINE });
    const { container } = renderSchema(ENGINE);
    await waitFor(() =>
      expect(container.querySelector('.json-tree-preview[data-format="yaml"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("yamlEngineRenderer module contract", () => {
  it("exports the renderer under the name the adapter's lazy import maps", () => {
    expect(typeof rendererModule.EngineWorkflowSchemaRenderer).toBe("function");
    expect(rendererModule.EngineWorkflowSchemaRenderer.length).toBe(1);
  });
});
