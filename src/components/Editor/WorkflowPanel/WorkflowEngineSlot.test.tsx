// WI-19 — the engine affordance is hidden unless the ENGINE flag is on.
//
// Until now, hiding this panel was the ONLY thing standing between a
// default-off feature and a runner that spawns AI providers and writes files:
// the Rust commands ignored the flag entirely. `workflow::guards` closes the
// backend half; this closes the UI half, and asserts that the VIEWER flag —
// read-only GitHub Actions authoring help — does not open it.
//
// Real settings and workflow stores (WI-18 mock-boundary policy); RTL queries
// by accessible role.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The panel reaches for the runner over IPC when mounted; only that boundary
// is faked. Everything the assertions look at is real.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { WorkflowEngineSlot } from "./WorkflowEngineSlot";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkflowStore } from "@/stores/workflowStore";

// The panel's React Flow canvas measures itself; jsdom has no ResizeObserver.
// A no-op is enough — nothing here asserts on layout.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const initialAdvanced = useSettingsStore.getState().advanced;

function setFlags(patch: { workflowViewer?: boolean; workflowEngine?: boolean }) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

/** Open the panel with a parsed graph, the state in which Run is offered. */
function openPanelWithGraph() {
  useWorkflowStore.setState({
    preview: {
      ...useWorkflowStore.getState().preview,
      panelOpen: true,
      graph: {
        name: "demo",
        triggers: [],
        env: {},
        defaults: {},
        steps: [],
        edges: [],
      },
      parseError: null,
      executionId: null,
      activeStepId: null,
      stepStatuses: {},
    },
  });
}

beforeEach(() => {
  setFlags({ workflowViewer: false, workflowEngine: false });
  openPanelWithGraph();
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

describe("WorkflowEngineSlot", () => {
  it("renders nothing while the engine is off", () => {
    const { container } = render(<WorkflowEngineSlot />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("stays closed with the VIEWER on and the engine off — the split's whole point", () => {
    // A user who wants expression completion must not thereby get a Run button
    // wired to a runner that executes YAML.
    setFlags({ workflowViewer: true, workflowEngine: false });
    const { container } = render(<WorkflowEngineSlot />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("mounts the engine panel once the engine flag is on", async () => {
    setFlags({ workflowViewer: false, workflowEngine: true });
    render(<WorkflowEngineSlot />);
    // React.lazy: the panel resolves on a microtask.
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeTruthy());
  });
});
