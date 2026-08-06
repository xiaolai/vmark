// Phase 5 — KnowledgeBasePanel behavior across lifecycle states.
// WI-12 — the graph view is behind React.lazy; the boundary is exercised here
// with the REAL lazy component resolving through vitest's dynamic import.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// Boundary mocks only: the Tauri-backed graph fetch and the canvas-based
// renderer. `./KbGraphView` itself is the real module — mocking it would erase
// the lazy boundary this file exists to test.
const getKbGraph = vi.fn();
vi.mock("@/services/contentServer", () => ({
  getKbGraph: (...a: unknown[]) => getKbGraph(...a),
}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: unknown[] }) => (
    <div data-testid="react-flow" data-nodes={nodes.length} />
  ),
  Background: () => <div data-testid="rf-bg" />,
  Controls: () => <div data-testid="rf-controls" />,
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));

beforeEach(() => {
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
  getKbGraph.mockReset();
  getKbGraph.mockResolvedValue({ nodes: [], edges: [] });
});

function renderPanel(overrides: Partial<Parameters<typeof KnowledgeBasePanel>[0]> = {}) {
  const handlers = {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onOpenInBrowser: vi.fn(),
    onPreviewSlides: vi.fn(),
    onExportSlides: vi.fn(),
    ...overrides,
  };
  render(<KnowledgeBasePanel {...handlers} />);
  return handlers;
}

describe("KnowledgeBasePanel", () => {
  it("shows the empty state with a Start button when stopped", async () => {
    const { onStart } = renderPanel();
    const btn = screen.getByRole("button", { name: /start knowledge base/i });
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows download progress while provisioning", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 50, total: 200 });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/25%/);
  });

  it("shows an error with a Retry that restarts", async () => {
    useContentServerStore.getState().setError("checksum mismatch");
    const { onStart } = renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent(/checksum mismatch/);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("embeds the KB iframe and wires toolbar actions when running", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    const { onStop, onOpenInBrowser } = renderPanel();
    const frame = screen.getByTitle(/knowledge base/i);
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:4321");
    await userEvent.click(screen.getByRole("button", { name: /open in browser/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onOpenInBrowser).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("shows the Suspense placeholder first, then the graph once the lazy chunk resolves", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    useContentServerStore.getState().setViewMode("graph");
    renderPanel();

    // Synchronously after the switch, the lazy module has not resolved: the
    // panel shows the Suspense placeholder and no graph.
    expect(screen.getByTestId("kb-graph-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-graph")).toBeNull();

    // …and it resolves through a real dynamic import, not a stub.
    expect(await screen.findByTestId("kb-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-graph-pending")).toBeNull();
    expect(getKbGraph).toHaveBeenCalledWith("/ws");
  });

  it("does not load the graph chunk while the site view is showing", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    renderPanel();
    expect(screen.queryByTestId("kb-graph-pending")).toBeNull();
    expect(screen.getByTitle(/knowledge base/i)).toBeInTheDocument();
    expect(getKbGraph).not.toHaveBeenCalled();
  });

  it("reaches KbGraphView only through a dynamic import — the eager-chunk regression guard", () => {
    // The build-level gate (pnpm lint:eager) catches this too, but only in
    // check:all. A static import here re-attaches xyflow + dagre + mermaid
    // (~3.2 MB) to the App chunk, so it is worth failing in seconds.
    const source = readFileSync(
      "src/components/KnowledgeBasePanel/KnowledgeBasePanel.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s[^\n]*from\s+["']\.\/KbGraphView["']/m);
    expect(source).toMatch(/import\(\s*["']\.\/KbGraphView["']\s*\)/);
  });

  it("wires Slidev preview and export actions when running", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    const { onPreviewSlides, onExportSlides } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /preview slides/i }));
    await userEvent.click(screen.getByRole("button", { name: /export slides/i }));
    expect(onPreviewSlides).toHaveBeenCalledOnce();
    expect(onExportSlides).toHaveBeenCalledOnce();
  });
});
