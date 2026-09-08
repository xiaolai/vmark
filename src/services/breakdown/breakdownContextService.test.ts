// @vitest-environment node
// WI-FL5.4 — breakdownContextService: the context lifecycle over the
// coherence IPC (ledger F7, coherence-contexts). Every write goes to Rust and
// is then re-read; a failure lands in the store and refreshes nothing; a
// stale or foreign-workspace response never overwrites the mirror.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useBreakdownStore, type BranchCandidate, type ContextRow } from "@/stores/breakdownStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  createContext,
  createContextFromBranch,
  refreshBranchCandidate,
  refreshContexts,
  setContextEnforcement,
} from "./breakdownContextService";

const mockInvoke = vi.mocked(invoke);

const DEFAULT_CONTEXT_ID = "00000000-0000-0000-0000-000000000000";

function context(p: Partial<ContextRow> & { id: string }): ContextRow {
  return {
    name: p.id,
    parent: null,
    enforcement: "greenhouse",
    visibleClaims: 0,
    errors: [],
    ...p,
  };
}

const DEFAULT_ROW = context({ id: DEFAULT_CONTEXT_ID, name: "default" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The commands invoked so far, in order. */
const commands = () => mockInvoke.mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  useBreakdownStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("refreshContexts", () => {
  it("mirrors the kernel's context list — the implicit default included — into the store", async () => {
    const rows = [DEFAULT_ROW, context({ id: "c-1", name: "night-arc", enforcement: "enforcing" })];
    mockInvoke.mockResolvedValueOnce(rows);

    await refreshContexts("/ws");

    expect(mockInvoke).toHaveBeenCalledWith("coherence_contexts", { workspaceRoot: "/ws" });
    expect(useBreakdownStore.getState().contexts).toEqual(rows);
  });

  it("a slow older refresh resolving after a newer one does not overwrite it", async () => {
    const slow = deferred<ContextRow[]>();
    const fast = deferred<ContextRow[]>();
    mockInvoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = refreshContexts("/ws");
    const second = refreshContexts("/ws");
    fast.resolve([DEFAULT_ROW, context({ id: "new" })]);
    await second;
    slow.resolve([DEFAULT_ROW, context({ id: "old" })]);
    await first;

    expect(useBreakdownStore.getState().contexts.map((c) => c.id)).toEqual([DEFAULT_CONTEXT_ID, "new"]);
  });

  it("a response or error arriving after the user left the workspace is dropped", async () => {
    useBreakdownStore.getState().setContexts([DEFAULT_ROW]);
    const late = deferred<ContextRow[]>();
    const lateError = deferred<ContextRow[]>();
    mockInvoke.mockReturnValueOnce(late.promise).mockReturnValueOnce(lateError.promise);

    const a = refreshContexts("/ws");
    const b = refreshContexts("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    late.resolve([context({ id: "foreign" })]);
    lateError.reject("kernel poisoned");
    await Promise.all([a, b]);

    expect(useBreakdownStore.getState().contexts).toEqual([DEFAULT_ROW]);
    expect(useBreakdownStore.getState().error).toBeNull();
  });

  it("does not select a context on the user's behalf — the selection stays on the implicit default (null)", async () => {
    mockInvoke.mockResolvedValueOnce([DEFAULT_ROW, context({ id: "c-1" })]);
    await refreshContexts("/ws");
    expect(useBreakdownStore.getState().selectedContext).toBeNull();
  });
});

describe("createContext", () => {
  it("creates a ROOT context (parent null → inherits the implicit default), then re-reads the list", async () => {
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([DEFAULT_ROW, context({ id: "c-1", name: "night-arc" })]);

    await createContext("/ws", "night-arc");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_context_create", {
      workspaceRoot: "/ws",
      name: "night-arc",
      parent: null,
    });
    expect(commands()).toEqual(["coherence_context_create", "coherence_contexts"]);
    expect(useBreakdownStore.getState().contexts.map((c) => c.name)).toEqual(["default", "night-arc"]);
  });

  it("a refused create surfaces the kernel's message and refreshes nothing", async () => {
    useBreakdownStore.getState().setContexts([DEFAULT_ROW]);
    mockInvoke.mockRejectedValueOnce({ code: "conflict", message: "a context named night-arc exists" });

    await createContext("/ws", "night-arc");

    expect(commands()).toEqual(["coherence_context_create"]);
    expect(useBreakdownStore.getState().error).toBe("a context named night-arc exists");
    expect(useBreakdownStore.getState().contexts).toEqual([DEFAULT_ROW]);
  });
});

describe("setContextEnforcement", () => {
  it("records the flag exactly as given and then re-reads the contexts — it never prompts itself (D4.3 confirmation is the caller's)", async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([DEFAULT_ROW, context({ id: "c-1", enforcement: "enforcing" })]);

    await setContextEnforcement("/ws", "c-1", true);

    expect(commands()).toEqual(["coherence_context_enforce", "coherence_contexts"]);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_context_enforce", {
      workspaceRoot: "/ws",
      context: "c-1",
      enforcing: true,
    });
    expect(useBreakdownStore.getState().contexts.find((c) => c.id === "c-1")?.enforcement).toBe("enforcing");
  });

  it("turning enforcement OFF goes through the same seam with enforcing=false", async () => {
    await setContextEnforcement("/ws", "c-1", false);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_context_enforce", expect.objectContaining({ enforcing: false }));
  });

  it("a refused flip surfaces the error and leaves the mirror as it was", async () => {
    const before = [DEFAULT_ROW, context({ id: "c-1" })];
    useBreakdownStore.getState().setContexts(before);
    mockInvoke.mockRejectedValueOnce("cycle detected");

    await setContextEnforcement("/ws", "c-1", true);

    expect(commands()).toEqual(["coherence_context_enforce"]);
    expect(useBreakdownStore.getState().error).toBe("cycle detected");
    expect(useBreakdownStore.getState().contexts).toEqual(before);
  });
});

describe("refreshBranchCandidate", () => {
  const candidate: BranchCandidate = { branch: "night-arc", context: "c-1", contextName: "night-arc", ambiguous: false };

  it("mirrors the pull-only candidate for the current branch, or null when there is none", async () => {
    mockInvoke.mockResolvedValueOnce(candidate);
    await refreshBranchCandidate("/ws");
    expect(useBreakdownStore.getState().branchCandidate).toEqual(candidate);

    mockInvoke.mockResolvedValueOnce(null);
    await refreshBranchCandidate("/ws");
    expect(useBreakdownStore.getState().branchCandidate).toBeNull();
  });

  it("never switches the selected context on its own — offering is the panel's job", async () => {
    mockInvoke.mockResolvedValueOnce(candidate);
    await refreshBranchCandidate("/ws");
    expect(useBreakdownStore.getState().selectedContext).toBeNull();
  });

  it("a superseded candidate response is dropped", async () => {
    const slow = deferred<BranchCandidate | null>();
    const fast = deferred<BranchCandidate | null>();
    mockInvoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = refreshBranchCandidate("/ws");
    const second = refreshBranchCandidate("/ws");
    fast.resolve(null);
    await second;
    slow.resolve(candidate);
    await first;

    expect(useBreakdownStore.getState().branchCandidate).toBeNull();
  });

  it("no-ops for a workspace that is not open", async () => {
    await refreshBranchCandidate("/not-open");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("createContextFromBranch", () => {
  it("creates the branch context, then re-reads BOTH the context list and the branch candidate", async () => {
    mockInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([DEFAULT_ROW, context({ id: "c-br", name: "night-arc" })])
      .mockResolvedValueOnce({ branch: "night-arc", context: "c-br", contextName: "night-arc", ambiguous: false });

    await createContextFromBranch("/ws");

    expect(commands()).toEqual(["coherence_context_from_branch", "coherence_contexts", "coherence_branch_candidate"]);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "coherence_context_from_branch", { workspaceRoot: "/ws" });
    expect(useBreakdownStore.getState().contexts.map((c) => c.id)).toEqual([DEFAULT_CONTEXT_ID, "c-br"]);
    expect(useBreakdownStore.getState().branchCandidate?.context).toBe("c-br");
  });

  it("a refused create surfaces the error and triggers neither refresh", async () => {
    mockInvoke.mockRejectedValueOnce("not a git repository");

    await createContextFromBranch("/ws");

    expect(commands()).toEqual(["coherence_context_from_branch"]);
    expect(useBreakdownStore.getState().error).toBe("not a git repository");
  });
});
