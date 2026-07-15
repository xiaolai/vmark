/**
 * Unit tests for the native-menu IPC helpers behind the recent-files and
 * recent-workspaces stores.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  queueNativeMenuSync,
  registerDockRecent,
  syncRecentFilesMenu,
  syncRecentWorkspacesMenu,
} from "./workspaceStoreHelpers";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("queueNativeMenuSync", () => {
  it("issues the first task synchronously (idle chain — no microtask delay)", () => {
    const task = vi.fn(async () => {});
    void queueNativeMenuSync("test-a", task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs queued tasks in enqueue order even when the first resolves late", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = queueNativeMenuSync("test-b", async () => {
      await gate;
      order.push("first");
    });
    const second = queueNativeMenuSync("test-b", async () => {
      order.push("second");
    });

    // The second task must not overtake the in-flight first one.
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps separate channels independent", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const blocked = queueNativeMenuSync("test-c", async () => {
      await gate;
      order.push("blocked");
    });
    const other = queueNativeMenuSync("test-d", async () => {
      order.push("other");
    });

    await other;
    expect(order).toEqual(["other"]);
    release();
    await blocked;
    expect(order).toEqual(["other", "blocked"]);
  });

  it("keeps draining the channel after a task rejects", async () => {
    const order: string[] = [];
    const failing = queueNativeMenuSync("test-e", async () => {
      order.push("failing");
      throw new Error("boom");
    });
    const next = queueNativeMenuSync("test-e", async () => {
      order.push("next");
    });

    await expect(failing).rejects.toThrow("boom");
    await next;
    expect(order).toEqual(["failing", "next"]);
  });
});

describe("syncRecentFilesMenu / syncRecentWorkspacesMenu", () => {
  it("sends the paths to the native menu command", () => {
    syncRecentFilesMenu(["/a.md", "/b.md"]);
    expect(invokeMock).toHaveBeenCalledWith("update_recent_files", { files: ["/a.md", "/b.md"] });

    syncRecentWorkspacesMenu(["/ws"]);
    expect(invokeMock).toHaveBeenCalledWith("update_recent_workspaces", { workspaces: ["/ws"] });
  });

  it("swallows IPC failures (a menu sync must never break the store action)", async () => {
    invokeMock.mockRejectedValue(new Error("no menu"));
    expect(() => syncRecentFilesMenu(["/a.md"])).not.toThrow();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
  });

  it("lands the LAST enqueued list last when IPC completes out of order", async () => {
    const seen: string[][] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    invokeMock.mockImplementation(async (_cmd, args) => {
      const files = (args as { files: string[] }).files;
      if (files.length === 2) await gate; // the first call is the slow one
      seen.push(files);
    });

    syncRecentFilesMenu(["/a.md", "/b.md"]);
    syncRecentFilesMenu(["/a.md"]); // user removed /b.md immediately after
    releaseFirst();

    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen).toEqual([["/a.md", "/b.md"], ["/a.md"]]);
  });
});

describe("registerDockRecent", () => {
  it("registers the path with the macOS dock", () => {
    registerDockRecent("/a.md");
    expect(invokeMock).toHaveBeenCalledWith("register_dock_recent", { path: "/a.md" });
  });

  it("stays silent when the command is unavailable (non-macOS)", async () => {
    invokeMock.mockRejectedValue(new Error("command not found"));
    expect(() => registerDockRecent("/a.md")).not.toThrow();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
  });
});
