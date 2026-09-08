// Phase 5 — KnowledgeBasePanel behavior across lifecycle states.
// WI-12 — the graph view is behind React.lazy; the boundary is exercised here
// with the REAL lazy component resolving through vitest's dynamic import.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  // The panel probes the runtime on open (WI-FL1.1); here it is always ready so
  // the lifecycle states below render as before. The missing states have their
  // own file, KnowledgeBasePanel.runtime.test.tsx.
  getContentServerRuntime: () =>
    Promise.resolve({
      node: "ready",
      nodePath: "/usr/local/bin/node",
      cli: "ready",
      cliSource: "provisioned",
      detail: null,
    }),
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
    // Start appears once the runtime probe has answered (WI-FL1.1).
    const btn = await screen.findByRole("button", { name: /start knowledge base/i });
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows download progress while provisioning", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 50, total: 200 });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/25%/);
  });

  // Audit 20260907 (#319): the percentage trusted `received` and `total` as
  // sent, so a stream that over-reported showed 150%, and a negative total was
  // a "valid" divisor.
  it("clamps a download percentage to 100 when received exceeds total", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 300, total: 200 });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/100%/);
  });

  it("shows 0% for a non-positive or non-finite total instead of dividing by it", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 50, total: -200 });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/\b0%/);
    cleanup();
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 50, total: Number.NaN });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/\b0%/);
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

  // Audit R2 (#631): `iframeUrl` is a ONE-TIME `/__auth?t=<nonce>` link. The
  // site view unmounts when the user switches to the graph, so coming back
  // mounted a fresh frame on a nonce the server had already burned.
  it("spends the one-time auth URL once and loads the plain URL afterwards", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    useContentServerStore.getState().setIframeUrl("http://127.0.0.1:4321/__auth?t=n0nce");
    renderPanel();

    const frame = screen.getByTitle(/knowledge base/i);
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:4321/__auth?t=n0nce");
    fireEvent.load(frame);

    // Graph and back: the spent nonce is gone, and the frame loads the site.
    useContentServerStore.getState().setViewMode("graph");
    expect(await screen.findByTestId("kb-graph")).toBeInTheDocument();
    expect(useContentServerStore.getState().iframeUrl).toBeNull();

    useContentServerStore.getState().setViewMode("site");
    expect(await screen.findByTitle(/knowledge base/i)).toHaveAttribute(
      "src",
      "http://127.0.0.1:4321",
    );
  });

  // The nonce is kept when the frame never got to use it — an unmount before
  // the handshake landed must not throw away an UNSPENT link.
  it("keeps the auth URL when the frame unmounts before it loaded", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    useContentServerStore.getState().setIframeUrl("http://127.0.0.1:4321/__auth?t=n0nce");
    renderPanel();

    useContentServerStore.getState().setViewMode("graph");
    expect(await screen.findByTestId("kb-graph")).toBeInTheDocument();
    expect(useContentServerStore.getState().iframeUrl).toBe("http://127.0.0.1:4321/__auth?t=n0nce");
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
    // The lazy import lives in the running view (audit 20260907, #318 split
    // the lifecycle views out of the panel); neither file may import it
    // statically, and the views file must still import it dynamically.
    const panel = readFileSync("src/components/KnowledgeBasePanel/KnowledgeBasePanel.tsx", "utf8");
    const views = readFileSync("src/components/KnowledgeBasePanel/KnowledgeBasePanelViews.tsx", "utf8");
    for (const source of [panel, views]) {
      expect(source).not.toMatch(/^\s*import\s[^\n]*from\s+["']\.\/KbGraphView["']/m);
    }
    expect(views).toMatch(/import\(\s*["']\.\/KbGraphView["']\s*\)/);
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

// Audit 20260907 round 3 (#625): the body was five independent `&&` branches,
// two of which carried a second condition (`provision`, `url`). A status whose
// companion value was absent matched no branch at all, so the panel rendered a
// header saying "Provisioning" or "Running" over an empty body — a dead surface
// with no way forward and nothing said about why.
describe("KnowledgeBasePanel — no status renders an empty body", () => {
  it("shows progress while provisioning even before the first progress event", () => {
    useContentServerStore.setState({ status: "provisioning", provision: null });
    renderPanel();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("says something when running without a URL rather than showing a blank pane", () => {
    useContentServerStore.setState({ status: "running", url: null });
    renderPanel();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("still shows the alert for an error the store could not describe", () => {
    useContentServerStore.setState({ status: "error", error: null });
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent(/\S/);
  });
});
