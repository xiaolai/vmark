// WI-2.4 — WorkflowCanvas mount tests.
//
// jsdom can't fully render @xyflow/react (needs ResizeObserver,
// real DOM measurement) but we can verify the component constructs,
// passes the IR through, and registers the JobNode custom type
// without throwing. Full visual verification happens in the live
// Tauri webview.

import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { WorkflowCanvas } from "../WorkflowCanvas";

// ResizeObserver isn't in jsdom; xyflow needs it.
beforeEach(() => {
  // @ts-expect-error jsdom shim
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // matchMedia shim used by some xyflow internals.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

import { beforeEach } from "vitest";

function emptyIR(): WorkflowIR {
  return {
    triggers: [],
    permissions: {},
    env: {},
    jobs: [],
    positions: {},
    diagnostics: [],
  };
}

function ir(jobIds: string[]): WorkflowIR {
  return {
    ...emptyIR(),
    jobs: jobIds.map((id) => ({
      id,
      needs: [],
      steps: [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    })),
  };
}

describe("WorkflowCanvas", () => {
  it("mounts without throwing for an empty IR", () => {
    expect(() => render(<WorkflowCanvas workflow={emptyIR()} />)).not.toThrow();
  });

  it("renders one xyflow node per job in the IR", async () => {
    const { container } = render(
      <WorkflowCanvas workflow={ir(["a", "b", "c"])} />,
    );
    // The xyflow subtree is lazy-loaded; wait for the chunk to resolve
    // and the nodes to mount. xyflow renders each node with
    // data-id=<id> so the IR's job ids reach the DOM as data attributes.
    await waitFor(() => {
      expect(container.querySelector('[data-id="a"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-id="b"]')).not.toBeNull();
    expect(container.querySelector('[data-id="c"]')).not.toBeNull();
  });

  it("registers the custom JobNode type — node text contains the job id label", async () => {
    const { container } = render(<WorkflowCanvas workflow={ir(["build"])} />);
    // The JobNode renders the job id as a label; its presence proves
    // the custom node type registered (default xyflow nodes don't
    // render job id text).
    await waitFor(() => {
      expect(container.textContent).toContain("build");
    });
  });
});
