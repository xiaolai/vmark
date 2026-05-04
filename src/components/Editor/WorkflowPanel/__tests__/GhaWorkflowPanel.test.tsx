// WI-2.4 — GhaWorkflowPanel composition tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { GhaWorkflowPanel } from "../GhaWorkflowPanel";

beforeEach(() => {
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
});

const emptyIR = (): WorkflowIR => ({
  triggers: [],
  permissions: {},
  env: {},
  jobs: [],
  positions: {},
  diagnostics: [],
});

describe("GhaWorkflowPanel", () => {
  it("renders the source editor on the left and the canvas on the right", () => {
    render(
      <GhaWorkflowPanel
        workflow={emptyIR()}
        sourceEditor={<div data-testid="source">SRC</div>}
      />,
    );
    expect(screen.getByTestId("source").textContent).toBe("SRC");
    // The canvas wrapper is identifiable by aria role on the shell.
    expect(screen.getByRole("group").getAttribute("aria-label")).toMatch(
      /workflow viewer/i,
    );
  });

  it("does not throw on a non-trivial IR", () => {
    const ir: WorkflowIR = {
      ...emptyIR(),
      jobs: [
        {
          id: "build",
          needs: [],
          steps: [],
          position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      ],
    };
    expect(() =>
      render(
        <GhaWorkflowPanel workflow={ir} sourceEditor={<div>src</div>} />,
      ),
    ).not.toThrow();
  });
});
