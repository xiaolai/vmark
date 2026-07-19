// WI-2b.6 — claim service: lifecycle IPC with store-surfaced errors.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  DEFAULT_CONTEXT_ID,
  performClaimAction,
  refreshClaims,
  scopeClaim,
} from "./claimService";
import { useClaimStore, type ClaimRow } from "@/stores/claimStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const mockInvoke = vi.mocked(invoke);

function claimRow(p: Partial<ClaimRow> & { claim: string }): ClaimRow {
  return {
    entryId: "e1",
    statement: "Elena is left-handed",
    maturity: "draft",
    invalidAt: null,
    ...p,
  };
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  useClaimStore.getState().reset();
  // The stale-response guard writes only for the active workspace (D1–D5);
  // tests refresh "/ws", so "/ws" must be the open workspace.
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("refreshClaims", () => {
  it("loads rows into the store", async () => {
    mockInvoke.mockResolvedValueOnce([claimRow({ claim: "c1" })] as never);
    await refreshClaims("/ws");
    expect(useClaimStore.getState().rows).toHaveLength(1);
    expect(useClaimStore.getState().error).toBeNull();
  });

  it("keeps stale rows and surfaces the error on failure", async () => {
    useClaimStore.getState().setRows([claimRow({ claim: "c1" })]);
    mockInvoke.mockRejectedValueOnce(new Error("kernel poisoned"));
    await refreshClaims("/ws");
    expect(useClaimStore.getState().rows).toHaveLength(1);
    expect(useClaimStore.getState().error).toContain("kernel poisoned");
  });

  it("drops a late response after the workspace changed (audit D1–D5)", async () => {
    let release: (rows: ClaimRow[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as never)),
    );
    const pending = refreshClaims("/ws");
    // User switches workspaces while the invoke is in flight.
    useWorkspaceStore.setState({ rootPath: "/other" });
    release([claimRow({ claim: "late" })]);
    await pending;
    // The stale "/ws" response must NOT overwrite the new workspace's mirror.
    expect(useClaimStore.getState().rows).toEqual([]);
  });

  it("drops a late ERROR after the workspace changed (audit D1–D5)", async () => {
    let reject: (e: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((_resolve, rej) => (reject = rej)),
    );
    const pending = refreshClaims("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    reject("kernel poisoned");
    await pending;
    // A stale failure must not surface an error on the new workspace.
    expect(useClaimStore.getState().error).toBeNull();
  });

  it("an inactive-workspace refresh does not starve the active one (audit #4/#5)", async () => {
    let releaseActive: (rows: ClaimRow[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (releaseActive = resolve as never)),
    );
    const active = refreshClaims("/ws"); // active workspace, takes a ticket
    // A stale refresh for a workspace the user already left must be a no-op:
    // it must not fire an invoke nor consume a ticket that supersedes /ws.
    await refreshClaims("/left");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    releaseActive([claimRow({ claim: "active" })]);
    await active;
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["active"]);
  });

  it("a slow refresh cannot overwrite a newer same-root refresh (audit #4)", async () => {
    let releaseFirst: (rows: ClaimRow[]) => void = () => {};
    mockInvoke
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseFirst = resolve as never)),
      )
      .mockResolvedValueOnce([claimRow({ claim: "newer" })]);
    const first = refreshClaims("/ws"); // ticket 1 — stays pending
    const second = refreshClaims("/ws"); // ticket 2 — resolves now
    await second;
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["newer"]);
    // The stale first response arrives last — a per-surface ticket must drop it.
    releaseFirst([claimRow({ claim: "older" })]);
    await first;
    expect(useClaimStore.getState().rows.map((r) => r.claim)).toEqual(["newer"]);
  });
});

describe("performClaimAction", () => {
  it("invokes the lifecycle command then refreshes", async () => {
    mockInvoke.mockResolvedValue([] as never);
    const ok = await performClaimAction("/ws", {
      action: "create",
      statement: "The harbor is open",
      source_path: "notes/harbor.md",
    });
    expect(ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_claim", {
      workspaceRoot: "/ws",
      request: {
        action: "create",
        statement: "The harbor is open",
        source_path: "notes/harbor.md",
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith("coherence_claims", {
      workspaceRoot: "/ws",
    });
  });

  it("a rejected act surfaces in the store and reports failure", async () => {
    mockInvoke.mockRejectedValueOnce(
      new Error("only a draft claim can be promoted (D2.3)"),
    );
    const ok = await performClaimAction("/ws", {
      action: "promote",
      claim: "c1",
    });
    expect(ok).toBe(false);
    expect(useClaimStore.getState().error).toContain("draft");
    // No refresh after a failed act — the list did not change.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("scopeClaim", () => {
  it("targets the default context (v1 surface)", async () => {
    await scopeClaim("/ws", "c1", false);
    expect(mockInvoke).toHaveBeenCalledWith("coherence_claim_scope", {
      workspaceRoot: "/ws",
      context: DEFAULT_CONTEXT_ID,
      claim: "c1",
      visible: false,
    });
  });

  it("surfaces scope failures", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("unknown context"));
    await scopeClaim("/ws", "c1", true);
    expect(useClaimStore.getState().error).toContain("unknown context");
  });
});
