// Workspace open-approval store (plan WI-1.3 / ADR-2).
// Opening a folder as a workspace grants the AI a new file tree, so it is gated
// by a one-shot approval: the handler requests approval and fails now; the user
// approves (minting a one-shot bound to the CANONICAL path + window + client);
// the AI retries and the retry consumes the one-shot. No standing grants.
import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkspaceApprovalStore,
  MAX_PENDING_WORKSPACE_APPROVALS,
  MAX_WORKSPACE_ONE_SHOTS,
  WORKSPACE_ONE_SHOT_TTL_MS,
} from "./workspaceApprovalStore";

function reset() {
  useWorkspaceApprovalStore.setState({ pending: [], oneShots: [] });
}

const KEY = { canonicalPath: "/Users/x/proj", windowLabel: "main", clientId: "c1" };

beforeEach(reset);

describe("workspaceApprovalStore", () => {
  it("queues a pending approval and dedups by id", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(1);
    expect(useWorkspaceApprovalStore.getState().pending[0]).toMatchObject({
      id: "id1",
      canonicalPath: KEY.canonicalPath,
      windowLabel: KEY.windowLabel,
      clientId: KEY.clientId,
    });
  });

  it("caps the pending queue (untrusted client cannot grow it unbounded)", () => {
    const s = useWorkspaceApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_WORKSPACE_APPROVALS + 5; i++) {
      s.requestApproval(`id${i}`, `/p${i}`, "main", "c1");
    }
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(
      MAX_PENDING_WORKSPACE_APPROVALS,
    );
  });

  it("approve mints a one-shot that consume spends exactly once", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    s.resolveApproval("id1", "approve");
    // Pending cleared, one-shot minted.
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    // First consume succeeds…
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(true);
    // …second fails (single-use).
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(false);
  });

  it("deny clears the pending prompt and mints no one-shot", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    s.resolveApproval("id1", "deny");
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(0);
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(false);
  });

  it("a one-shot is bound to path, window, AND client — no cross-consumption", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    s.resolveApproval("id1", "approve");
    // A different client cannot consume it (Codex F-10).
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, "OTHER")).toBe(false);
    // A different path cannot consume it (symlink/substitution safety).
    expect(s.consumeOneShot("/Users/x/other", KEY.windowLabel, KEY.clientId)).toBe(false);
    // A different window cannot consume it.
    expect(s.consumeOneShot(KEY.canonicalPath, "doc-2", KEY.clientId)).toBe(false);
    // The exact match still works.
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(true);
  });

  it("resolveApproval on an unknown id is a no-op", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.resolveApproval("nope", "approve");
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("requestApproval reports queued / existing / overloaded", () => {
    const s = useWorkspaceApprovalStore.getState();
    expect(s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe("queued");
    // Same semantic key, fresh id → deduped, no second dialog (M10).
    expect(s.requestApproval("id2", KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe("existing");
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(1);
    // Fill the queue with distinct paths, then the next distinct one overflows.
    for (let i = 0; i < MAX_PENDING_WORKSPACE_APPROVALS - 1; i++) {
      s.requestApproval(`p${i}`, `/p${i}`, "main", "c1");
    }
    expect(s.requestApproval("overflow", "/overflow", "main", "c1")).toBe("overloaded");
  });

  it("hasOneShot peeks without consuming", () => {
    const s = useWorkspaceApprovalStore.getState();
    s.requestApproval("id1", KEY.canonicalPath, KEY.windowLabel, KEY.clientId);
    s.resolveApproval("id1", "approve");
    expect(s.hasOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(true);
    // Peeking twice does not spend it.
    expect(s.hasOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(true);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("does not spend an expired one-shot (TTL)", () => {
    // Seed a one-shot minted just over the TTL ago.
    useWorkspaceApprovalStore.setState({
      pending: [],
      oneShots: [
        {
          ...KEY,
          createdAt: Date.now() - WORKSPACE_ONE_SHOT_TTL_MS - 1000,
        },
      ],
    });
    const s = useWorkspaceApprovalStore.getState();
    expect(s.hasOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(false);
    expect(s.consumeOneShot(KEY.canonicalPath, KEY.windowLabel, KEY.clientId)).toBe(false);
    // The expired grant is pruned, not left lingering.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("physically prunes expired one-shots on every action (not only consume/approve)", () => {
    const stale = () => ({
      ...KEY,
      createdAt: Date.now() - WORKSPACE_ONE_SHOT_TTL_MS - 1000,
    });
    const s = useWorkspaceApprovalStore.getState();

    // hasOneShot prunes.
    useWorkspaceApprovalStore.setState({ pending: [], oneShots: [stale()] });
    s.hasOneShot("/other", "main", "c1");
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);

    // requestApproval prunes.
    useWorkspaceApprovalStore.setState({ pending: [], oneShots: [stale()] });
    s.requestApproval("r1", "/new", "main", "c1");
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);

    // deny-resolution prunes.
    useWorkspaceApprovalStore.setState({
      pending: [{ id: "d1", canonicalPath: "/p", windowLabel: "main", clientId: "c1" }],
      oneShots: [stale()],
    });
    s.resolveApproval("d1", "deny");
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("caps minted one-shots to MAX_WORKSPACE_ONE_SHOTS (drops oldest)", () => {
    const s = useWorkspaceApprovalStore.getState();
    for (let i = 0; i < MAX_WORKSPACE_ONE_SHOTS + 3; i++) {
      s.requestApproval(`id${i}`, `/proj${i}`, "main", "c1");
      s.resolveApproval(`id${i}`, "approve");
    }
    const { oneShots } = useWorkspaceApprovalStore.getState();
    expect(oneShots).toHaveLength(MAX_WORKSPACE_ONE_SHOTS);
    // The earliest grants were evicted; the newest survive.
    expect(s.consumeOneShot("/proj0", "main", "c1")).toBe(false);
    expect(s.consumeOneShot(`/proj${MAX_WORKSPACE_ONE_SHOTS + 2}`, "main", "c1")).toBe(true);
  });
});
