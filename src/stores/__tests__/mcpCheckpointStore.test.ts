// MCP checkpoint store — push/list/get/clear and retention math.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useMcpCheckpointStore,
  CHECKPOINT_PER_ANCHOR_LIMIT,
  CHECKPOINT_TOTAL_BYTE_LIMIT,
} from "../mcpCheckpointStore";

function reset() {
  useMcpCheckpointStore.setState({ checkpoints: [], hydrated: false });
}

function push(args: {
  filePath?: string | null;
  tabId?: string;
  contentBefore?: string;
  description?: string;
}) {
  return useMcpCheckpointStore.getState().push({
    tabId: args.tabId ?? "tab-1",
    // Honor explicit null (untitled docs) — don't `??` it away.
    filePath: "filePath" in args ? args.filePath ?? null : "/x.md",
    tool: "document.write",
    description: args.description ?? "test",
    contentBefore: args.contentBefore ?? "before",
    revisionBefore: "rev-A",
    revisionAfter: "rev-B",
  });
}

describe("useMcpCheckpointStore", () => {
  beforeEach(() => {
    reset();
  });

  it("push assigns id + timestamp + byteSize and inserts newest-first", () => {
    const id1 = push({ contentBefore: "first" });
    const id2 = push({ contentBefore: "second" });
    const list = useMcpCheckpointStore.getState().checkpoints;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(id2);
    expect(list[1].id).toBe(id1);
    expect(list[0].byteSize).toBe("second".length);
    expect(list[0].timestamp).toBeGreaterThan(0);
    expect(list[0].id).toMatch(/^cp-/);
  });

  it("get returns the matching checkpoint or null", () => {
    const id = push({});
    expect(useMcpCheckpointStore.getState().get(id)?.id).toBe(id);
    expect(useMcpCheckpointStore.getState().get("cp-nonexistent")).toBeNull();
  });

  it("list filters by filePath when provided", () => {
    push({ filePath: "/a.md" });
    push({ filePath: "/b.md" });
    push({ filePath: "/a.md" });
    const aOnly = useMcpCheckpointStore.getState().list({
      filePath: "/a.md",
    });
    expect(aOnly).toHaveLength(2);
    expect(aOnly.every((cp) => cp.filePath === "/a.md")).toBe(true);
  });

  it("list filters by tabId when provided", () => {
    push({ tabId: "t-1", filePath: null });
    push({ tabId: "t-2", filePath: null });
    push({ tabId: "t-1", filePath: null });
    const t1 = useMcpCheckpointStore.getState().list({ tabId: "t-1" });
    expect(t1).toHaveLength(2);
  });

  it("clear without filter wipes everything", () => {
    push({});
    push({});
    useMcpCheckpointStore.getState().clear();
    expect(useMcpCheckpointStore.getState().checkpoints).toHaveLength(0);
  });

  it("clear with filePath drops matching entries only", () => {
    push({ filePath: "/a.md" });
    push({ filePath: "/b.md" });
    useMcpCheckpointStore.getState().clear({ filePath: "/a.md" });
    const remaining = useMcpCheckpointStore.getState().checkpoints;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filePath).toBe("/b.md");
  });

  it("retention drops oldest beyond the per-anchor cap", () => {
    for (let i = 0; i < CHECKPOINT_PER_ANCHOR_LIMIT + 10; i++) {
      push({ contentBefore: `v${i}` });
    }
    const list = useMcpCheckpointStore.getState().checkpoints;
    expect(list).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
    // Newest entry should be the last we pushed.
    expect(list[0].contentBefore).toBe(
      `v${CHECKPOINT_PER_ANCHOR_LIMIT + 10 - 1}`,
    );
    // Oldest 10 should be gone.
    expect(list[list.length - 1].contentBefore).toBe("v10");
  });

  it("retention isolates per-anchor caps (two paths each get 50)", () => {
    for (let i = 0; i < CHECKPOINT_PER_ANCHOR_LIMIT + 5; i++) {
      push({ filePath: "/a.md", contentBefore: `a${i}` });
      push({ filePath: "/b.md", contentBefore: `b${i}` });
    }
    const aOnly = useMcpCheckpointStore.getState().list({
      filePath: "/a.md",
    });
    const bOnly = useMcpCheckpointStore.getState().list({
      filePath: "/b.md",
    });
    expect(aOnly).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
    expect(bOnly).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
  });

  it("retention enforces global byte cap", () => {
    // Big payload — 1 MiB per checkpoint × 6 → ~6 MiB total, over the
    // 5 MiB cap. Should drop the oldest until we're under the limit.
    const big = "x".repeat(1024 * 1024);
    for (let i = 0; i < 6; i++) {
      push({ contentBefore: big });
    }
    const list = useMcpCheckpointStore.getState().checkpoints;
    const total = list.reduce((s, cp) => s + cp.byteSize, 0);
    expect(total).toBeLessThanOrEqual(CHECKPOINT_TOTAL_BYTE_LIMIT);
    // At 1 MiB each we should have 5 entries left (newest).
    expect(list.length).toBe(5);
  });

  it("untitled tabs (filePath: null) get tab-id based isolation", () => {
    for (let i = 0; i < CHECKPOINT_PER_ANCHOR_LIMIT + 3; i++) {
      push({ filePath: null, tabId: "untitled-1", contentBefore: `u${i}` });
    }
    const list = useMcpCheckpointStore.getState().checkpoints;
    expect(list).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
    expect(list.every((cp) => cp.filePath === null)).toBe(true);
  });
});
