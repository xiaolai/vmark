// Tests for GhaWorkflowSidePanel — side panel for standalone .yml workflow files.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { GhaWorkflowSidePanel } from "../GhaWorkflowSidePanel";
import { useWorkflowStore } from "@/stores/workflowStore";

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
  useWorkflowStore.getState().resetGha();
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
    useWorkflowStore.getState().ghaOpenPanel();
    const { container } = render(<GhaWorkflowSidePanel />);
    expect(screen.getByRole("complementary")).toBeDefined();
    // Empty-state placeholder uses a known class; i18n key resolution
    // varies by test setup so the class is the stable assertion target.
    expect(
      container.querySelector(".gha-workflow-side-panel__empty"),
    ).not.toBeNull();
  });

  it("renders the parse-error banner when parseError is set", () => {
    useWorkflowStore.getState().ghaOpenPanel();
    useWorkflowStore
      .getState()
      .setGhaWorkflow(null, "Invalid YAML at line 5");
    render(<GhaWorkflowSidePanel />);
    expect(screen.getByText(/Invalid YAML at line 5/)).toBeDefined();
  });

  it("renders the canvas when an IR is set", () => {
    useWorkflowStore.getState().ghaOpenPanel();
    useWorkflowStore.getState().setGhaWorkflow(sampleIr());
    render(<GhaWorkflowSidePanel />);
    expect(screen.getByRole("complementary")).toBeDefined();
  });

  it("returns to closed when panel is toggled off", () => {
    useWorkflowStore.getState().ghaOpenPanel();
    useWorkflowStore.getState().setGhaWorkflow(sampleIr());
    const { rerender, container } = render(<GhaWorkflowSidePanel />);
    expect(container.firstChild).not.toBeNull();
    useWorkflowStore.getState().ghaClosePanel();
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
    useWorkflowStore.getState().ghaOpenPanel();
    useWorkflowStore.getState().setGhaWorkflow(sampleIr());
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
    useWorkflowStore.getState().ghaOpenPanel();
    useWorkflowStore.getState().setGhaWorkflow(sampleIr());
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

    useWorkflowStore.getState().ghaClosePanel();
    rerender(<GhaWorkflowSidePanel />);
    useWorkflowStore.getState().ghaOpenPanel();
    rerender(<GhaWorkflowSidePanel />);

    const widthAfterReopen = parent?.style.getPropertyValue(
      "--gha-panel-width",
    );
    // Both should be defined (effect ran) and equal (latch held).
    expect(widthAfterDrag).toMatch(/^\d+px$/);
    expect(widthAfterReopen).toBe(widthAfterDrag);
  });
});
