// @vitest-environment node
// WI-3.2/3.4 — semanticActs: provenance + delegation refreshes carry the
// stale-response guard (audit D1–D5), so a late response for a workspace
// the user already left never overwrites the new workspace's mirror.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { refreshProvenance, refreshDelegations } from "./semanticActs";
import {
  useBreakdownStore,
  type DelegationRow,
  type ProvenanceCandidate,
} from "@/stores/breakdownStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  useBreakdownStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

const candidate: ProvenanceCandidate = {
  path: "essays/derived.md",
  proposed: 2,
};

const delegationRow: DelegationRow = {
  grant: "g-1",
  delegate: "codex-cli",
  scope: ["resolve.waive"],
  expires: "2099-01-01T00:00:00Z",
};

describe("refreshProvenance", () => {
  it("writes candidates for the active workspace", async () => {
    mockInvoke.mockResolvedValueOnce([candidate]);
    await refreshProvenance("/ws");
    expect(useBreakdownStore.getState().provenance).toEqual([candidate]);
  });

  it("drops a late response after the workspace changed (audit D1–D5)", async () => {
    let release: (rows: ProvenanceCandidate[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as never)),
    );
    const pending = refreshProvenance("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    release([candidate]);
    await pending;
    expect(useBreakdownStore.getState().provenance).toEqual([]);
  });

  it("surfaces the error without throwing", async () => {
    mockInvoke.mockRejectedValueOnce("kernel poisoned");
    await refreshProvenance("/ws");
    expect(useBreakdownStore.getState().error).toBe("kernel poisoned");
  });

  it("drops a late ERROR after the workspace changed (audit D1–D5)", async () => {
    let reject: (e: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((_resolve, rej) => (reject = rej)),
    );
    const pending = refreshProvenance("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    reject("kernel poisoned");
    await pending;
    expect(useBreakdownStore.getState().error).toBeNull();
  });

  it("no-ops for an inactive workspace (audit #4/#5)", async () => {
    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshProvenance("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("refreshDelegations", () => {
  it("writes rows for the active workspace", async () => {
    mockInvoke.mockResolvedValueOnce([delegationRow]);
    await refreshDelegations("/ws");
    expect(useBreakdownStore.getState().delegations).toEqual([delegationRow]);
  });

  it("drops a late response after the workspace changed (audit D1–D5)", async () => {
    let release: (rows: DelegationRow[]) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as never)),
    );
    const pending = refreshDelegations("/ws");
    useWorkspaceStore.setState({ rootPath: "/other" });
    release([delegationRow]);
    await pending;
    expect(useBreakdownStore.getState().delegations).toEqual([]);
  });

  it("no-ops for an inactive workspace (audit #4/#5)", async () => {
    useWorkspaceStore.setState({ rootPath: "/other" });
    mockInvoke.mockClear();
    await refreshDelegations("/ws");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
