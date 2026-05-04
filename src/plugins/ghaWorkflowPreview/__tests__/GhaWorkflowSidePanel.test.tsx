// Tests for GhaWorkflowSidePanel — side panel for standalone .yml workflow files.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { GhaWorkflowSidePanel } from "../GhaWorkflowSidePanel";
import { useGhaWorkflowPanelStore } from "@/stores/ghaWorkflowPanelStore";

beforeEach(() => {
  // jsdom shims required by @xyflow/react under WorkflowCanvas.
  // @ts-expect-error jsdom shim
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  useGhaWorkflowPanelStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("GhaWorkflowSidePanel", () => {
  it("renders nothing when panel is closed", () => {
    const { container } = render(<GhaWorkflowSidePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an empty-state container when panel is open but no IR is set", () => {
    useGhaWorkflowPanelStore.getState().openPanel();
    const { container } = render(<GhaWorkflowSidePanel />);
    expect(screen.getByRole("complementary")).toBeDefined();
    // Empty-state placeholder uses a known class; i18n key resolution
    // varies by test setup so the class is the stable assertion target.
    expect(
      container.querySelector(".gha-workflow-side-panel__empty"),
    ).not.toBeNull();
  });

  it("renders the parse-error banner when parseError is set", () => {
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore
      .getState()
      .setWorkflow(null, "Invalid YAML at line 5");
    render(<GhaWorkflowSidePanel />);
    expect(screen.getByText(/Invalid YAML at line 5/)).toBeDefined();
  });

  it("renders the canvas when an IR is set", () => {
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    render(<GhaWorkflowSidePanel />);
    expect(screen.getByRole("complementary")).toBeDefined();
  });

  it("returns to closed when panel is toggled off", () => {
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    const { rerender, container } = render(<GhaWorkflowSidePanel />);
    expect(container.firstChild).not.toBeNull();
    useGhaWorkflowPanelStore.getState().closePanel();
    rerender(<GhaWorkflowSidePanel />);
    expect(container.firstChild).toBeNull();
  });
});
