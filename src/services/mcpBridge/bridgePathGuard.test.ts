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
});
