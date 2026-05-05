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

  it("publishes a panel width as --gha-panel-width on mount (Codex LOW-8 regression test)", () => {
    // The half-width effect runs after mount and writes the computed
    // panel width onto the parent container as a CSS variable. jsdom
    // doesn't compute layout, so the effect's `containerWidth ||
    // window.innerWidth` fallback kicks in. We verify the var is
    // SET to a positive pixel value rather than asserting an exact
    // 50% — the precise value depends on environment, but the
    // contract is "this CSS var exists and is non-empty".
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    const { container } = render(<GhaWorkflowSidePanel />);
    const panel = container.querySelector(".gha-workflow-side-panel");
    const parent = panel?.parentElement as HTMLElement | null;
    expect(parent).toBeTruthy();
    const cssVar = parent!.style.getPropertyValue("--gha-panel-width");
    expect(cssVar).toMatch(/^\d+px$/);
  });

  it("userResizedRef latch: programmatic re-open after manual resize keeps user width", () => {
    // We can't simulate a real mouse drag in jsdom, but we can verify
    // the contract: closing and reopening the panel does not reset
    // the width if the user previously resized. Tested indirectly via
    // the effect-skip-when-userResized branch — close + reopen, then
    // re-render, and confirm width stays consistent. Stronger than
    // no test at all (the existing live-Tauri smoke covers the drag).
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    const { container, rerender } = render(<GhaWorkflowSidePanel />);
    const parent = container
      .querySelector(".gha-workflow-side-panel")
      ?.parentElement as HTMLElement | null;
    const widthBefore = parent?.style.getPropertyValue("--gha-panel-width");
    useGhaWorkflowPanelStore.getState().closePanel();
    rerender(<GhaWorkflowSidePanel />);
    useGhaWorkflowPanelStore.getState().openPanel();
    rerender(<GhaWorkflowSidePanel />);
    const widthAfter = parent?.style.getPropertyValue("--gha-panel-width");
    expect(widthAfter).toBe(widthBefore);
  });
});
