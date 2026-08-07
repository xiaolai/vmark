// WI-5.3 — merge-audit service: the read-only merge-affected edge set.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { fetchMergeAffectedEdges } from "./mergeAuditService";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("fetchMergeAffectedEdges", () => {
  it("invokes the audit command and returns the affected edges", async () => {
    const edges = [
      { txf: "t1", input: 0, upstream: "u", downstream: "d", kind: "dependency" },
    ];
    mockInvoke.mockResolvedValueOnce(edges);
    const out = await fetchMergeAffectedEdges("/ws");
    expect(mockInvoke).toHaveBeenCalledWith("coherence_merge_audit", {
      workspaceRoot: "/ws",
    });
    expect(out).toEqual(edges);
  });

  it("returns an empty set for a non-merge HEAD", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    expect(await fetchMergeAffectedEdges("/ws")).toEqual([]);
  });

  it("propagates a command error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("kernel poisoned"));
    await expect(fetchMergeAffectedEdges("/ws")).rejects.toThrow("kernel poisoned");
  });
});
