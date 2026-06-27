// MCP bridge path guard — store adapter that assembles allowedRoots and
// delegates to the pure path policy. Security: confines bridge file ops to
// the workspace + open-document tree.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import { collectAllowedRoots, checkBridgePath } from "./bridgePathGuard";

const invokeMock = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

function resetStores() {
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
  useDocumentStore.setState({ documents: {} });
}

function openDoc(tabId: string, filePath: string | null) {
  useDocumentStore.getState().initDocument(tabId, "", filePath);
}

describe("collectAllowedRoots", () => {
  beforeEach(resetStores);

  it("is empty with no workspace and no open documents", () => {
    expect(collectAllowedRoots()).toEqual([]);
  });

  it("includes the workspace root when in workspace mode", () => {
    useWorkspaceStore.setState({
      rootPath: "/Users/me/project",
      isWorkspaceMode: true,
      config: null,
    });
    expect(collectAllowedRoots()).toContain("/Users/me/project");
  });

  it("ignores rootPath when not in workspace mode", () => {
    useWorkspaceStore.setState({
      rootPath: "/Users/me/project",
      isWorkspaceMode: false,
      config: null,
    });
    expect(collectAllowedRoots()).toEqual([]);
  });

  it("includes the parent directory of every open document", () => {
    openDoc("t1", "/Users/me/docs/a.md");
    openDoc("t2", "/Users/me/notes/b.md");
    const roots = collectAllowedRoots();
    expect(roots).toContain("/Users/me/docs");
    expect(roots).toContain("/Users/me/notes");
  });

  it("skips untitled (null filePath) documents", () => {
    openDoc("t1", null);
    expect(collectAllowedRoots()).toEqual([]);
  });

  it("deduplicates roots shared by workspace and open docs", () => {
    useWorkspaceStore.setState({
      rootPath: "/Users/me/project",
      isWorkspaceMode: true,
      config: null,
    });
    openDoc("t1", "/Users/me/project/a.md");
    openDoc("t2", "/Users/me/project/b.md");
    const roots = collectAllowedRoots();
    // /Users/me/project (workspace) + /Users/me/project (both parents) → one.
    expect(roots.filter((r) => r === "/Users/me/project")).toHaveLength(1);
  });
});

describe("checkBridgePath", () => {
  beforeEach(() => {
    resetStores();
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects any path when nothing is open", async () => {
    expect((await checkBridgePath("/Users/me/.zshenv")).allowed).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("allows a sibling of an open document", async () => {
    openDoc("t1", "/Users/me/docs/a.md");
    expect((await checkBridgePath("/Users/me/docs/b.md")).allowed).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("mcp_bridge_check_path", {
      filePath: "/Users/me/docs/b.md",
      allowedRoots: ["/Users/me/docs"],
    });
  });

  it("rejects a path outside the open document's directory", async () => {
    openDoc("t1", "/Users/me/docs/a.md");
    expect((await checkBridgePath("/Users/me/.ssh/id_rsa")).allowed).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects a '..' traversal from within an allowed root", async () => {
    openDoc("t1", "/Users/me/docs/a.md");
    expect(
      (await checkBridgePath("/Users/me/docs/../.zshenv")).allowed,
    ).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a denial when the Rust symlink/canonical guard rejects", async () => {
    openDoc("t1", "/Users/me/docs/a.md");
    invokeMock.mockRejectedValueOnce("Path is outside the workspace and open documents");

    const decision = await checkBridgePath("/Users/me/docs/link/secret.md");

    expect(decision).toEqual({
      allowed: false,
      reason: "Path is outside the workspace and open documents",
    });
  });

  // Contract pin: the invoke command name and arg KEYS (filePath, allowedRoots)
  // are bound to the Rust mcp_bridge_check_path params (file_path, allowed_roots)
  // by Tauri's camelCase→snake_case convention. Renaming either side silently
  // breaks the bridge at runtime — nothing else catches it. This pins the JS
  // half; see src-tauri/src/mcp_bridge_path_guard.rs module header for the Rust
  // half. The runtime camelCase↔snake_case binding itself is E2E-only.
  it("pins the mcp_bridge_check_path invoke contract (command + arg keys)", async () => {
    openDoc("t1", "/Users/me/docs/a.md");

    await checkBridgePath("/Users/me/docs/b.md");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0] as [string, object];
    expect(command).toBe("mcp_bridge_check_path");
    expect(Object.keys(args).sort()).toEqual(["allowedRoots", "filePath"]);
  });
});
