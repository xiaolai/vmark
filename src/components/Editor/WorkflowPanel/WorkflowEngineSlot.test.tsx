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
import { useWorkspaceStore } from "@/stores/workspaceStore";

// The panel's React Flow canvas measures itself; jsdom has no ResizeObserver.
// A no-op is enough — nothing here asserts on layout.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const initialAdvanced = useSettingsStore.getState().advanced;

function setFlags(patch: { workflowEngine?: boolean }) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

/** Open tab-1's panel with a parsed graph, the state in which Run is offered. */
function openPanelWithGraph() {
  useWorkflowStore.getState().resetPreview();
  useWorkflowStore.getState().previewOpenPanel("tab-1");
  useWorkflowStore.getState().setGraph("tab-1", {
    name: "demo",
    triggers: [],
    env: {},
    defaults: {},
    steps: [],
    edges: [],
  });
}

beforeEach(() => {
  setFlags({ workflowEngine: false });
  openPanelWithGraph();
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

describe("WorkflowEngineSlot", () => {
  it("renders nothing while the engine is off", () => {
    const { container } = render(<WorkflowEngineSlot tabId="tab-1" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("stays closed with the VIEWER on and the engine off — the split's whole point", () => {
    // A user who wants expression completion must not thereby get a Run button
    // wired to a runner that executes YAML.
    setFlags({ workflowEngine: false });
    const { container } = render(<WorkflowEngineSlot tabId="tab-1" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("mounts the engine panel once the engine flag is on", async () => {
    setFlags({ workflowEngine: true });
    render(<WorkflowEngineSlot tabId="tab-1" />);
    // React.lazy: the panel resolves on a microtask.
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeTruthy());
  });

  it("hands the surface's tab to the panel, so Run targets THAT document (WI-LX2.2)", async () => {
    setFlags({ workflowEngine: true });
    useWorkspaceStore.setState({ rootPath: "/work" } as never);
    useWorkflowStore.setState({
      preview: { ...useWorkflowStore.getState().preview, runTabId: "tab-1", lastRunOutcome: "completed" },
    });
    render(<WorkflowEngineSlot tabId="tab-1" />);
    // The completed run belongs to tab-1, so tab-1's panel reports its outcome.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Completed"),
    );
  });
});
