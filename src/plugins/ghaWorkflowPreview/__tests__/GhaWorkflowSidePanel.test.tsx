// Tests for GhaWorkflowSidePanel — side panel for standalone .yml workflow files.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("userResizedRef latch: simulated drag flips the latch and re-mount preserves width", () => {
    // Real mouse drag simulated via fireEvent on the resize handle:
    // mousedown → mousemove (delta) → mouseup. The handler stamps
    // userResizedRef.current = true on the first delta. After that,
    // closing and reopening the panel must preserve the user's width
    // (no auto-50% reset).
    useGhaWorkflowPanelStore.getState().openPanel();
    useGhaWorkflowPanelStore.getState().setWorkflow(sampleIr());
    const { container, rerender } = render(<GhaWorkflowSidePanel />);
    const handle = container.querySelector(
      ".gha-workflow-side-panel__resize-handle",
    ) as HTMLElement;
    expect(handle).toBeTruthy();

    // Trigger the drag start. The component attaches mousemove/mouseup
    // to `document` (not window), so we dispatch there to actually
    // hit the listeners and flip userResizedRef.
    fireEvent.mouseDown(handle, { clientX: 800 });
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);

    // After the drag, the userResizedRef.current is true. Now toggle
    // panelOpen and re-render: the half-width effect must NOT
    // overwrite the width.
    const parent = handle.parentElement?.parentElement as HTMLElement | null;
    const widthAfterDrag = parent?.style.getPropertyValue("--gha-panel-width");

    useGhaWorkflowPanelStore.getState().closePanel();
    rerender(<GhaWorkflowSidePanel />);
    useGhaWorkflowPanelStore.getState().openPanel();
    rerender(<GhaWorkflowSidePanel />);

    const widthAfterReopen = parent?.style.getPropertyValue(
      "--gha-panel-width",
    );
    // Both should be defined (effect ran) and equal (latch held).
    expect(widthAfterDrag).toMatch(/^\d+px$/);
    expect(widthAfterReopen).toBe(widthAfterDrag);
  });
});
