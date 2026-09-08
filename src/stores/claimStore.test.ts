// @vitest-environment node
// WI-FL5.4 — claimStore: the panel's mirror of the Rust claim ledger (ledger
// F7, coherence-claims). The store's own transitions, plus the one property a
// mirror must hold under concurrency: a superseded or foreign-workspace
// response never overwrites what the user is looking at.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useClaimStore, type ClaimRow } from "./claimStore";
import { refreshClaims } from "@/services/claims/claimService";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const mockInvoke = vi.mocked(invoke);

function row(claim: string, statement = `${claim} statement`): ClaimRow {
  return { claim, entryId: `e-${claim}`, statement, maturity: "draft", invalidAt: null, visible: true };
}

/** A hand-resolvable invoke, so two refreshes can be interleaved on purpose. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  useClaimStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("claimStore — panel state", () => {
  it("starts closed, empty, idle and without a draft", () => {
    expect(useClaimStore.getState()).toMatchObject({
      rows: [],
      panelOpen: false,
      loading: false,
      error: null,
      draftStatement: null,
      draftSourcePath: null,
    });
  });

  it("setRows REPLACES the listing rather than merging into it", () => {
    useClaimStore.getState().setRows([row("a"), row("b")]);
    useClaimStore.getState().setRows([row("c")]);
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["c"]);
  });

  it("togglePanel flips; setPanelOpen is absolute", () => {
    useClaimStore.getState().togglePanel();
    expect(useClaimStore.getState().panelOpen).toBe(true);
    useClaimStore.getState().togglePanel();
    expect(useClaimStore.getState().panelOpen).toBe(false);
    useClaimStore.getState().setPanelOpen(true);
    useClaimStore.getState().setPanelOpen(true);
    expect(useClaimStore.getState().panelOpen).toBe(true);
  });

  it("extract-from-selection hands over the statement WITH its provenance and opens the panel", () => {
    useClaimStore.getState().setDraft("Elena is left-handed", "/ws/notes/elena.md");
    expect(useClaimStore.getState()).toMatchObject({
      draftStatement: "Elena is left-handed",
      draftSourcePath: "/ws/notes/elena.md",
      panelOpen: true,
    });
  });

  it("clearing the draft leaves the panel open — the user is still in it", () => {
    useClaimStore.getState().setDraft("stmt", "/ws/a.md");
    useClaimStore.getState().setDraft(null, null);
    expect(useClaimStore.getState()).toMatchObject({ draftStatement: null, draftSourcePath: null, panelOpen: true });
  });

  it("setError / setLoading are independent of each other and of the rows", () => {
    useClaimStore.getState().setRows([row("a")]);
    useClaimStore.getState().setLoading(true);
    useClaimStore.getState().setError("kernel poisoned");
    expect(useClaimStore.getState()).toMatchObject({ loading: true, error: "kernel poisoned" });
    expect(useClaimStore.getState().rows).toHaveLength(1);
    useClaimStore.getState().setError(null);
    expect(useClaimStore.getState().error).toBeNull();
  });

  it("reset returns every field to its initial value, the draft included", () => {
    useClaimStore.getState().setRows([row("a")]);
    useClaimStore.getState().setLoading(true);
    useClaimStore.getState().setError("x");
    useClaimStore.getState().setDraft("stmt", "/ws/a.md");

    useClaimStore.getState().reset();

    expect(useClaimStore.getState()).toMatchObject({
      rows: [],
      panelOpen: false,
      loading: false,
      error: null,
      draftStatement: null,
      draftSourcePath: null,
    });
  });
});

describe("claimStore — stale-response guards, as the mirror sees them", () => {
  it("a slow older refresh resolving AFTER a newer one does not overwrite the newer rows", async () => {
    const slow = deferred<ClaimRow[]>();
    const fast = deferred<ClaimRow[]>();
    mockInvoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = refreshClaims("/ws");
    const second = refreshClaims("/ws");

    fast.resolve([row("new")]);
    await second;
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["new"]);

    slow.resolve([row("old")]);
    await first;
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["new"]);
    expect(useClaimStore.getState().loading).toBe(false);
  });

  it("only the newest refresh may clear `loading` — a superseded one finishing early leaves it on", async () => {
    const slow = deferred<ClaimRow[]>();
    const fast = deferred<ClaimRow[]>();
    mockInvoke.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = refreshClaims("/ws");
    const second = refreshClaims("/ws");
    expect(useClaimStore.getState().loading).toBe(true);

    slow.resolve([row("old")]);
    await first;
    expect(useClaimStore.getState().loading).toBe(true); // the newest is still in flight
    expect(useClaimStore.getState().rows).toEqual([]);

    fast.resolve([row("new")]);
    await second;
    expect(useClaimStore.getState().loading).toBe(false);
  });

  it("a response for a workspace the user has since left is dropped, rows and error alike", async () => {
    useClaimStore.getState().setRows([row("kept")]);
    const late = deferred<ClaimRow[]>();
    const lateError = deferred<ClaimRow[]>();
    mockInvoke.mockReturnValueOnce(late.promise).mockReturnValueOnce(lateError.promise);

    const a = refreshClaims("/ws");
    const b = refreshClaims("/ws");
    useWorkspaceStore.setState({ rootPath: "/elsewhere" });

    late.resolve([row("foreign")]);
    lateError.reject("kernel poisoned");
    await Promise.all([a, b]);

    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["kept"]);
    expect(useClaimStore.getState().error).toBeNull();
  });

  it("a refresh for a workspace that is not open never reaches the store, and takes no ticket from the active one", async () => {
    useClaimStore.getState().setRows([row("kept")]);
    mockInvoke.mockResolvedValue([row("active")]);

    await refreshClaims("/not-open");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useClaimStore.getState().loading).toBe(false);

    await refreshClaims("/ws");
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["active"]);
  });

  it("a failed refresh keeps the stale rows visible and surfaces the error", async () => {
    useClaimStore.getState().setRows([row("kept")]);
    mockInvoke.mockRejectedValueOnce("kernel poisoned");

    await refreshClaims("/ws");

    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["kept"]);
    expect(useClaimStore.getState().error).toBe("kernel poisoned");
    expect(useClaimStore.getState().loading).toBe(false);
  });
});
