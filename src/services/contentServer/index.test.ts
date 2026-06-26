// Phase 5 — content-server service invoke wrappers.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openUrl = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

import {
  startContentServer,
  stopContentServer,
  getContentServerStatus,
  openKbInBrowser,
  startSlidevPreview,
  exportSlidev,
} from "./index";

beforeEach(() => {
  invoke.mockReset();
  openUrl.mockReset();
});

describe("contentServer service", () => {
  it("starts the server with the workspace root", async () => {
    invoke.mockResolvedValue({ url: "http://127.0.0.1:5", port: 5 });
    const handle = await startContentServer("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_start", { workspaceRoot: "/ws" });
    expect(handle.port).toBe(5);
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

  it("opens the KB in a browser via a Rust-minted nonce URL (no token in JS)", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:9/__auth?t=abc123nonce");
    openUrl.mockResolvedValue(undefined);
    const url = await openKbInBrowser("/ws");
    expect(invoke).toHaveBeenCalledWith("content_server_browser_url", { workspaceRoot: "/ws" });
    expect(url).toBe("http://127.0.0.1:9/__auth?t=abc123nonce");
    expect(openUrl).toHaveBeenCalledWith(url);
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
});
