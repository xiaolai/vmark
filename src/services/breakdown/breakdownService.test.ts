// WI-1.9b — breakdown service: refresh/resolve/revise over the coherence IPC.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const mockEmitOpenFile = vi.fn(() => Promise.resolve());
vi.mock("@/services/navigation/openFileEvent", () => ({
  emitOpenFileInCurrentWindow: (...a: unknown[]) => mockEmitOpenFile(...a),
}));

import {
  checkEdge,
  refreshBranchCandidate,
  refreshBreakdown,
  refreshContexts,
  refreshMergeNotice,
  resolveEdge,
  reviseEdge,
  resolveWorkspacePath,
} from "./breakdownService";
import { useAiProviderStore } from "@/stores/aiStore";
import { useBreakdownStore, type EdgeRow } from "@/stores/breakdownStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const mockInvoke = vi.mocked(invoke);

function row(p: Partial<EdgeRow> & { txf: string }): EdgeRow {
  return {
    input: 0,
    upstream: "up-obj",
    upstream_path: "notes/source.md",
    pinned: "rev1:" + "a".repeat(64),
    downstream: "down-obj",
    downstream_path: "essays/derived.md",
    downstream_rev: "rev1:" + "b".repeat(64),
    state: "version-stale",
    prior_waivers: 0,
    ...p,
  };
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  mockEmitOpenFile.mockClear();
  useBreakdownStore.getState().reset();
  // The stale-response guard writes only for the active workspace (D1–D5);
  // tests refresh "/ws", so "/ws" must be the open workspace.
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("refreshBreakdown", () => {
  it("invokes coherence_breakdown with the workspace root and writes the rows", async () => {
    const rows = [row({ txf: "t1" })];
    mockInvoke.mockResolvedValueOnce(rows);
    await refreshBreakdown("/ws");
    expect(mockInvoke).toHaveBeenCalledWith("coherence_breakdown", {
      workspaceRoot: "/ws",
      context: null,
    });
    const s = useBreakdownStore.getState();
    expect(s.rows).toEqual(rows);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("sets loading before the invoke and clears it after", async () => {
    let release: (rows: EdgeRow[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const done = refreshBreakdown("/ws");
    expect(useBreakdownStore.getState().loading).toBe(true);
    release([]);
    await done;
    expect(useBreakdownStore.getState().loading).toBe(false);
  });

  it("clears a previous error on a successful refresh", async () => {
    useBreakdownStore.getState().setError("old failure");
    mockInvoke.mockResolvedValueOnce([]);
    await refreshBreakdown("/ws");
    expect(useBreakdownStore.getState().error).toBeNull();
  });

  it("on failure writes the error, keeps the old rows, and clears loading", async () => {
    const old = [row({ txf: "t-old" })];
    useBreakdownStore.getState().setRows(old);
    mockInvoke.mockRejectedValueOnce(new Error("kernel poisoned"));
    await refreshBreakdown("/ws");
    const s = useBreakdownStore.getState();
    expect(s.error).toBe("kernel poisoned");
    expect(s.rows).toEqual(old);
    expect(s.loading).toBe(false);
  });

  it("stringifies non-Error rejections (Rust commands reject with strings)", async () => {
    mockInvoke.mockRejectedValueOnce("no such workspace");
    await refreshBreakdown("/ws");
    expect(useBreakdownStore.getState().error).toBe("no such workspace");
  });

  it("drops a late response after the workspace changed (audit D1–D5)", async () => {
    let release: (rows: EdgeRow[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as never)),
    );
    const pending = refreshBreakdown("/ws");
    // User switches workspaces while the invoke is in flight.
    useWorkspaceStore.setState({ rootPath: "/other" });
    release([row({ txf: "late" })]);
    await pending;
    // The stale "/ws" response must NOT overwrite the new workspace's mirror.
    expect(useBreakdownStore.getState().rows).toEqual([]);
  });

  it("drops a late ERROR after the workspace changed (audit D1–D5)", async () => {
    let reject: (e: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((_resolve, rej) => (reject = rej)),
    );
    const pending = refreshBreakdown("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    reject("kernel poisoned");
    await pending;
    // A stale failure must not surface an error on the new workspace.
    expect(useBreakdownStore.getState().error).toBeNull();
  });
});

describe("resolveEdge", () => {
  it("invokes coherence_resolve then refreshes the breakdown", async () => {
    mockInvoke.mockResolvedValueOnce({ entry_id: "e1" }); // resolve
    mockInvoke.mockResolvedValueOnce([]); // refresh
    await resolveEdge("/ws", { action: "accept-newer", txf: "t1", input: 0 });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_resolve", {
      workspaceRoot: "/ws",
      request: { action: "accept-newer", txf: "t1", input: 0 },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "coherence_breakdown", {
      workspaceRoot: "/ws",
      context: null,
    });
  });

  it("passes the waiver reason through", async () => {
    mockInvoke.mockResolvedValue([]);
    await resolveEdge("/ws", {
      action: "waive",
      txf: "t1",
      input: 2,
      reason: "intentionally stale",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_resolve", {
      workspaceRoot: "/ws",
      request: {
        action: "waive",
        txf: "t1",
        input: 2,
        reason: "intentionally stale",
      },
    });
  });

  it("on failure writes the error and does NOT refresh", async () => {
    mockInvoke.mockRejectedValueOnce("a waiver requires a reason");
    await resolveEdge("/ws", { action: "waive", txf: "t1", input: 0 });
    expect(useBreakdownStore.getState().error).toBe("a waiver requires a reason");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("reviseEdge", () => {
  it("opens the downstream file resolved against the workspace root", async () => {
    await reviseEdge("/ws", "essays/derived.md");
    expect(mockEmitOpenFile).toHaveBeenCalledWith("/ws/essays/derived.md");
  });

  it("writes the error when the open-file emit fails", async () => {
    mockEmitOpenFile.mockRejectedValueOnce(new Error("window gone"));
    await reviseEdge("/ws", "a.md");
    expect(useBreakdownStore.getState().error).toBe("window gone");
  });
});

describe("resolveWorkspacePath", () => {
  it.each([
    { root: "/ws", rel: "a/b.md", expected: "/ws/a/b.md" },
    { root: "/ws/", rel: "a.md", expected: "/ws/a.md" },
    { root: "C:\\ws\\", rel: "a.md", expected: "C:\\ws/a.md" },
    { root: "/ws", rel: "文档/说明.md", expected: "/ws/文档/说明.md" },
  ])("joins $root + $rel → $expected", ({ root, rel, expected }) => {
    expect(resolveWorkspacePath(root, rel)).toBe(expected);
  });
});

describe("checkEdge (WI-2b.5)", () => {
  it("surfaces a store error when no provider is active", async () => {
    useAiProviderStore.setState({ activeProvider: null });
    await checkEdge("/ws", "t1", 0);
    expect(useBreakdownStore.getState().error).toBe("no-active-provider");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("invokes coherence_check with the active provider then refreshes", async () => {
    useAiProviderStore.setState({
      activeProvider: "claude",
      restProviders: [],
      cliProviders: [{ type: "claude", path: "/usr/local/bin/claude" }],
    } as never);
    mockInvoke.mockResolvedValue([] as never);
    await checkEdge("/ws", "t1", 2);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_check", {
      workspaceRoot: "/ws",
      txf: "t1",
      input: 2,
      provider: {
        provider: "claude",
        apiKey: null,
        endpoint: null,
        cliPath: "/usr/local/bin/claude",
      },
      model: null,
    });
    // The follow-up refresh pulled the breakdown again.
    expect(mockInvoke).toHaveBeenCalledWith("coherence_breakdown", {
      workspaceRoot: "/ws",
      context: null,
    });
  });

  it("a failing check lands in the store error, never throws", async () => {
    useAiProviderStore.setState({
      activeProvider: "claude",
      restProviders: [],
      cliProviders: [],
    } as never);
    mockInvoke.mockRejectedValueOnce(new Error("provider exploded"));
    await checkEdge("/ws", "t1", 0);
    expect(useBreakdownStore.getState().error).toContain("provider exploded");
  });
});

describe("secondary refreshes (contexts/branch/merge) — guards", () => {
  it("refreshContexts writes rows, surfaces errors, and no-ops when inactive", async () => {
    const rows = [
      {
        id: "c-1",
        name: "night-arc",
        parent: null,
        enforcement: "greenhouse" as const,
        visibleClaims: 0,
        errors: [],
      },
    ];
    mockInvoke.mockResolvedValueOnce(rows);
    await refreshContexts("/ws");
    expect(useBreakdownStore.getState().contexts).toEqual(rows);

    mockInvoke.mockRejectedValueOnce("kernel poisoned");
    await refreshContexts("/ws");
    expect(useBreakdownStore.getState().error).toBe("kernel poisoned");

    // Inactive workspace → complete no-op (no invoke, audit #4/#5).
    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshContexts("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("refreshBranchCandidate writes, surfaces errors, and no-ops when inactive", async () => {
    const candidate = {
      branch: "night-arc",
      context: "c-1",
      contextName: "night-arc",
      ambiguous: false,
    };
    mockInvoke.mockResolvedValueOnce(candidate);
    await refreshBranchCandidate("/ws");
    expect(useBreakdownStore.getState().branchCandidate).toEqual(candidate);

    mockInvoke.mockRejectedValueOnce("no repo");
    await refreshBranchCandidate("/ws");
    expect(useBreakdownStore.getState().error).toBe("no repo");

    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshBranchCandidate("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("refreshMergeNotice writes, surfaces errors, and no-ops when inactive", async () => {
    const notice = { sha: "abc123", time: "2026-07-19T00:00:00Z" };
    mockInvoke.mockResolvedValueOnce(notice);
    await refreshMergeNotice("/ws");
    expect(useBreakdownStore.getState().mergeNotice).toEqual(notice);

    mockInvoke.mockRejectedValueOnce("no repo");
    await refreshMergeNotice("/ws");
    expect(useBreakdownStore.getState().error).toBe("no repo");

    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshMergeNotice("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("refreshBreakdown no-ops for an inactive workspace (audit #4/#5)", async () => {
    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshBreakdown("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
