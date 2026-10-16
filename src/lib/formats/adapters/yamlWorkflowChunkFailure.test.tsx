/**
 * Audit 20260804-F3 — the GHA workflow renderer chunk fails locally, and recovers.
 *
 * `schemaRenderers` is a plain `ComponentType` map that SplitPaneEditor mounts
 * directly, so before this the adapter shipped a bare `<Suspense>` over a
 * MODULE-LEVEL `React.lazy`. Two consequences, both user-visible:
 *   - a rejected `./yamlWorkflowRenderer` import escaped the preview pane and
 *     hit the editor-wide boundary, and
 *   - that boundary's "try again" remounted the SAME lazy object, which had
 *     memoized the rejection — the pane could never come back without a
 *     window restart.
 *
 * Nothing is mocked. The failure cases drive the adapter's real renderer
 * through its loader parameter (`ghaWorkflowRendererOver`) — the chunk fetch is
 * the boundary, and a module registry cannot be made to re-fail a module that
 * resolved once. The success case loads the REAL chunk through the registered
 * production renderer.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { SURFACE_IMPORT_WAIT } from "@/test/waitBudget";
import type { PreviewRendererProps } from "../types";
import { ghaWorkflowRendererOver, yamlFormat } from "./yaml";

function Workbench() {
  return <div data-testid="workflow-workbench" />;
}

/** A chunk loader that rejects `failures` times, then resolves. */
function flakyChunk(failures: number) {
  const state = { failures, loads: 0 };
  const load = async (): Promise<{ default: ComponentType<PreviewRendererProps> }> => {
    state.loads += 1;
    if (state.failures > 0) {
      state.failures -= 1;
      throw new Error("Failed to fetch dynamically imported module");
    }
    return { default: Workbench };
  };
  return { state, load };
}

function renderPreview(Renderer: ComponentType<PreviewRendererProps> | undefined) {
  if (!Renderer) throw new Error("yaml adapter registers no gha-workflow renderer");
  return render(<Renderer content={"on: push\n"} diagnostics={[]} tabId="tab-1" />);
}

describe("GHA workflow schema renderer — chunk failure is local and retryable", () => {
  it("shows an in-pane failure surface instead of rethrowing to the editor boundary", async () => {
    const chunk = flakyChunk(1);
    renderPreview(ghaWorkflowRendererOver(chunk.load));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.queryByTestId("workflow-workbench")).toBeNull();
  });

  it("recovers when the user retries — a FRESH lazy, not the cached rejection", async () => {
    const chunk = flakyChunk(1);
    renderPreview(ghaWorkflowRendererOver(chunk.load));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByTestId("workflow-workbench")).toBeTruthy();
    // Two loads: the failed one and the retry. A memoized lazy would have
    // replayed the rejection without calling the loader again.
    expect(chunk.state.loads).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps failing in place while the chunk keeps failing, and recovers after", async () => {
    const chunk = flakyChunk(2);
    renderPreview(ghaWorkflowRendererOver(chunk.load));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load/i);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByTestId("workflow-workbench")).toBeTruthy();
    expect(chunk.state.loads).toBe(3);
  });

  it("the registered renderer loads the real workflow chunk", async () => {
    // jsdom has no ResizeObserver, and the workbench's flow canvas measures
    // with one: without it the canvas throws on mount and the boundary shows
    // the failure surface. That happens AFTER the first paint, so checking
    // for the alert at once raced the error and passed or failed by load.
    const scope = globalThis as { ResizeObserver?: unknown };
    const before = scope.ResizeObserver;
    scope.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      const { container } = renderPreview(yamlFormat.schemaRenderers?.["gha-workflow"]);
      // The canvas mounted, and its effects (where the measuring starts) ran.
      // The REAL chunk pays Vite's in-test transform of the workflow graph
      // (2.4-3.6s alone on a loaded machine), so the general 5s budget failed
      // in a full check:all run; it is a heavy-import wait (see waitBudget).
      await waitFor(
        () => expect(container.querySelector(".react-flow__renderer")).not.toBeNull(),
        SURFACE_IMPORT_WAIT,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(container.querySelector('[data-schema="gha-workflow"]')).not.toBeNull();
    } finally {
      if (before === undefined) delete scope.ResizeObserver;
      else scope.ResizeObserver = before;
    }
  });
});
