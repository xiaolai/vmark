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
