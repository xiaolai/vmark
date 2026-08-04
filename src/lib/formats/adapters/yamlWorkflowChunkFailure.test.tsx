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
 * Mock boundary: the workflow renderer MODULE (the chunk whose load is the
 * subject). Everything else — the adapter, the boundary, the retry — is real.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const chunk = vi.hoisted(() => ({ failures: 0, loads: 0 }));

vi.mock("./yamlWorkflowRenderer", () => {
  chunk.loads += 1;
  if (chunk.failures > 0) {
    chunk.failures -= 1;
    throw new Error("Failed to fetch dynamically imported module");
  }
  return {
    GhaWorkflowSchemaRenderer: () => <div data-testid="workflow-workbench" />,
  };
});

import { yamlFormat } from "./yaml";

const Renderer = yamlFormat.schemaRenderers?.["gha-workflow"];

function renderWorkflowPreview() {
  if (!Renderer) throw new Error("yaml adapter registers no gha-workflow renderer");
  render(<Renderer content="on: push\n" diagnostics={[]} tabId="tab-1" />);
}

// Test order is load-bearing: vitest caches a module once it has resolved, so
// the failure cases must run BEFORE the chunk is allowed to succeed. A failed
// factory is not cached (verified: the factory is re-invoked on the next
// import), which is what makes the retry case observable at all.
describe("GHA workflow schema renderer — chunk failure is local and retryable", () => {
  it("shows an in-pane failure surface instead of rethrowing to the editor boundary", async () => {
    chunk.failures = 1;
    renderWorkflowPreview();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/failed to load/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("recovers when the user retries — a FRESH lazy, not the cached rejection", async () => {
    chunk.failures = 1;
    const before = chunk.loads;
    renderWorkflowPreview();
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByTestId("workflow-workbench")).toBeTruthy();
    // Two evaluations: the failed one and the retry. A module-level lazy would
    // have replayed the memoized rejection without touching the import.
    expect(chunk.loads).toBe(before + 2);
  });

  it("renders the workbench when the chunk loads", async () => {
    chunk.failures = 0;
    renderWorkflowPreview();
    expect(await screen.findByTestId("workflow-workbench")).toBeTruthy();
  });
});
