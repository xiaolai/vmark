/**
 * Audit 20260804-F4 — the KB graph chunk fails inside the panel, not at the root.
 *
 * The graph is ~3.2 MB of xyflow + dagre behind `React.lazy`, and the panel
 * wrapped it in a bare `<Suspense>`. Suspense handles the PENDING half only:
 * a rejected chunk propagated past the panel to App's root boundary, so a
 * failed fetch of an optional side panel blanked the entire window. And the
 * lazy object was module-level, so its memoized rejection outlived every
 * remount — there was no recovery short of restarting.
 *
 * Mock boundary: the graph MODULE (the chunk under test) plus the Tauri-backed
 * graph fetch it would call. The panel, the boundary and the retry are real.
 * Kept in its own file so `KnowledgeBasePanel.test.tsx` can keep loading the
 * REAL `./KbGraphView` — mocking it there would erase the lazy boundary that
 * file exists to exercise.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const chunk = vi.hoisted(() => ({ failures: 0, loads: 0 }));

vi.mock("./KbGraphView", () => {
  chunk.loads += 1;
  if (chunk.failures > 0) {
    chunk.failures -= 1;
    throw new Error("Failed to fetch dynamically imported module");
  }
  return { KbGraphView: () => <div data-testid="kb-graph" /> };
});
vi.mock("@/services/contentServer", () => ({
  getKbGraph: () => Promise.resolve({ nodes: [], edges: [] }),
}));

import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
  useContentServerStore.setState({ status: "running", url: "http://127.0.0.1:4321" });
  useContentServerStore.getState().setViewMode("graph");
});

function renderPanel() {
  render(
    <KnowledgeBasePanel
      onStart={vi.fn()}
      onStop={vi.fn()}
      onOpenInBrowser={vi.fn()}
      onPreviewSlides={vi.fn()}
      onExportSlides={vi.fn()}
    />,
  );
}

// Failure cases run first on purpose: vitest caches a module once it resolves,
// while a factory that threw is re-invoked on the next import.
describe("KB graph chunk failure stays inside the panel", () => {
  it("renders the graph error in place, with the panel chrome intact", async () => {
    chunk.failures = 1;
    renderPanel();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load the graph/i);
    // Containment, stated as an assertion: the surrounding panel — the thing a
    // root-boundary escape would have taken with it — is still on screen.
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /open in browser/i })).toBeTruthy();
  });

  it("loads the graph when the user retries", async () => {
    chunk.failures = 1;
    const before = chunk.loads;
    renderPanel();
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));

    expect(await screen.findByTestId("kb-graph")).toBeTruthy();
    // The retry re-imported rather than replaying a memoized rejection.
    expect(chunk.loads).toBe(before + 2);
  });

  it("renders the graph normally when the chunk loads", async () => {
    chunk.failures = 0;
    renderPanel();
    expect(await screen.findByTestId("kb-graph")).toBeTruthy();
  });
});
