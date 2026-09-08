// @vitest-environment node
// Phase 5 — content-server service invoke wrappers.
// (Moved from index.test.ts when the implementation moved to client.ts;
// `**/index.ts` is coverage-excluded as a barrel.)
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openUrl = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

import {
  startContentServer,
  stopContentServer,
  getContentServerStatus,
  getKbAuthUrl,
  openKbInBrowser,
  getKbGraph,
  startSlidevPreview,
  exportSlidev,
  getContentServerRuntime,
  type ContentServerRuntime,
} from "./client";

beforeEach(() => {
  invoke.mockReset();
  openUrl.mockReset();
});

describe("contentServer service", () => {
  it("starts the server with the workspace root and its trust (WI-FL3.6)", async () => {
    invoke.mockResolvedValue({ url: "http://127.0.0.1:5", port: 5, trusted: true });
    const handle = await startContentServer("/ws", true);
    expect(invoke).toHaveBeenCalledWith("content_server_start", {
      workspaceRoot: "/ws",
      trusted: true,
    });
    expect(handle.port).toBe(5);
    expect(handle.trusted).toBe(true);
    await startContentServer("/ws", false);
    expect(invoke).toHaveBeenLastCalledWith("content_server_start", {
      workspaceRoot: "/ws",
      trusted: false,
    });
  });

  it("stops the server", async () => {
    invoke.mockResolvedValue(undefined);
    await stopContentServer("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_stop", { workspaceRoot: "/ws" });
  });

  it("queries status", async () => {
    invoke.mockResolvedValue(null);
    expect(await getContentServerStatus("/ws")).toBeNull();
  });

  it("mints a fresh single-use auth URL from the Rust side", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:9/__auth?t=nonce1");
    const url = await getKbAuthUrl("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_browser_url", { workspaceRoot: "/ws" });
    expect(url).toBe("http://127.0.0.1:9/__auth?t=nonce1");
    // No browser open on the bare mint path.
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens the KB in a browser via a Rust-minted nonce URL (no token in JS)", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:9/__auth?t=abc123nonce");
    openUrl.mockResolvedValue(undefined);
    const url = await openKbInBrowser("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_browser_url", { workspaceRoot: "/ws" });
    expect(url).toBe("http://127.0.0.1:9/__auth?t=abc123nonce");
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("fetches and parses the relationship graph JSON", async () => {
    invoke.mockResolvedValue('{"nodes":[{"id":"a"}],"links":[]}');
    const graph = await getKbGraph("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_graph", { workspaceRoot: "/ws" });
    expect(graph).toEqual({ nodes: [{ id: "a" }], links: [] });
  });

  it("rejects when the graph payload is not valid JSON", async () => {
    invoke.mockResolvedValue("<html>proxy error</html>");
    await expect(getKbGraph("/ws")).rejects.toThrow(SyntaxError);
  });

  it("starts a Slidev preview", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:9/slidev/");
    const url = await startSlidevPreview("/ws", "/d/deck.md");
    expect(invoke).toHaveBeenCalledWith("content_server_slidev_preview", {
      workspaceRoot: "/ws",
      deckPath: "/d/deck.md",
    });
    expect(url).toContain("/slidev/");
  });

  it("wraps export errors with a clear message", async () => {
    invoke.mockRejectedValue(new Error("no chromium"));
    await expect(exportSlidev("/ws", "/d.md", "pdf", "/out.pdf")).rejects.toThrow(
      /Slidev export failed: no chromium/
    );
    expect(invoke).toHaveBeenCalledWith("content_server_slidev_export", {
      workspaceRoot: "/ws",
      deckPath: "/d.md",
      format: "pdf",
      outputPath: "/out.pdf",
    });
  });

  // WI-FL1.1 — the probe takes no arguments and never starts a server.
  it("probes the runtime and hands the Rust report through unchanged", async () => {
    const report: ContentServerRuntime = {
      node: "missing",
      nodePath: null,
      cli: "ready",
      cliSource: "env",
      detail: "node not found on PATH",
    };
    invoke.mockResolvedValue(report);
    expect(await getContentServerRuntime()).toEqual(report);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("content_server_runtime");
  });

  it("stringifies non-Error export failures", async () => {
    invoke.mockRejectedValue("spawn failed");
    await expect(exportSlidev("/ws", "/d.md", "png", "/out.png")).rejects.toThrow(
      /Slidev export failed: spawn failed/
    );
  });
});
