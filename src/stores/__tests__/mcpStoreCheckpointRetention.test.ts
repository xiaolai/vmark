/**
 * mcpStore — checkpoint retention tests (audit #956).
 *
 * Covers the two memory bounds enforced by applyRetention():
 *   - per-anchor cap (CHECKPOINT_PER_ANCHOR_LIMIT = 50 per filePath / tab)
 *   - total-byte cap (CHECKPOINT_TOTAL_BYTE_LIMIT = 5 MiB across all anchors)
 *
 * applyRetention is internal; we exercise it via the public
 * checkpointSetAll action, which calls it directly on the supplied array.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_PER_ANCHOR_LIMIT,
  CHECKPOINT_TOTAL_BYTE_LIMIT,
  type CheckpointTool,
  type MCPCheckpoint,
  useMcpStore,
} from "../mcpStore";

const initialState = useMcpStore.getState();

beforeEach(() => {
  useMcpStore.setState(initialState, true);
});

interface MakeOpts {
  filePath?: string | null;
  tabId?: string;
  byteSize?: number;
  tool?: CheckpointTool;
}

function makeCheckpoint(id: number, opts: MakeOpts = {}): MCPCheckpoint {
  return {
    id: `cp-${id}`,
    tabId: opts.tabId ?? "tab-default",
    filePath: opts.filePath ?? "/foo.md",
    timestamp: 1_000_000 + id, // monotonic
    tool: opts.tool ?? "document.write",
    description: `checkpoint ${id}`,
    contentBefore: "",
    revisionBefore: `r-${id}-before`,
    revisionAfter: `r-${id}-after`,
    byteSize: opts.byteSize ?? 100,
  };
}

function currentCheckpoints(): MCPCheckpoint[] {
  return useMcpStore.getState().checkpoint.checkpoints;
}

describe("applyRetention — per-anchor cap (#956)", () => {
  it("caps at CHECKPOINT_PER_ANCHOR_LIMIT for a single filePath", () => {
    const input = Array.from({ length: CHECKPOINT_PER_ANCHOR_LIMIT + 1 }, (_, i) =>
      makeCheckpoint(i, { filePath: "/foo.md" }),
    );
    useMcpStore.getState().checkpointSetAll(input);

    const retained = currentCheckpoints();
    expect(retained).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
    // The function iterates input order and rejects once count reaches the
    // cap — so the FIRST 50 are kept and the trailing one is dropped.
    // Because checkpointPush prepends newest-first, this means the newest
    // entries win in production. The test pins the iteration order
    // contract — change at your peril.
    expect(retained[0].id).toBe("cp-0");
    expect(retained[retained.length - 1].id).toBe(
      `cp-${CHECKPOINT_PER_ANCHOR_LIMIT - 1}`,
    );
    expect(retained.find((cp) => cp.id === `cp-${CHECKPOINT_PER_ANCHOR_LIMIT}`)).toBeUndefined();
  });

  it("falls back to tab:<tabId> as the anchor key when filePath is null", () => {
    const input = Array.from({ length: CHECKPOINT_PER_ANCHOR_LIMIT + 1 }, (_, i) =>
      makeCheckpoint(i, { filePath: null, tabId: "tab-1" }),
    );
    useMcpStore.getState().checkpointSetAll(input);

    // Untitled documents (filePath: null) still get capped — the anchor
    // identity is the tab id, not the path.
    expect(currentCheckpoints()).toHaveLength(CHECKPOINT_PER_ANCHOR_LIMIT);
  });

  it("isolates anchors — capping one does not affect another", () => {
    const aBatch = Array.from({ length: CHECKPOINT_PER_ANCHOR_LIMIT }, (_, i) =>
      makeCheckpoint(i, { filePath: "/a.md" }),
    );
    const bBatch = Array.from({ length: CHECKPOINT_PER_ANCHOR_LIMIT }, (_, i) =>
      makeCheckpoint(i + 1000, { filePath: "/b.md" }),
    );
    const extraA = makeCheckpoint(9999, { filePath: "/a.md" });
    useMcpStore.getState().checkpointSetAll([...aBatch, ...bBatch, extraA]);

    const retained = currentCheckpoints();
    expect(retained).toHaveLength(2 * CHECKPOINT_PER_ANCHOR_LIMIT);
    // /a.md is full → 9999th gets dropped; /b.md is untouched.
    expect(retained.find((cp) => cp.id === "cp-9999")).toBeUndefined();
    const bIds = retained.filter((cp) => cp.filePath === "/b.md").length;
    expect(bIds).toBe(CHECKPOINT_PER_ANCHOR_LIMIT);
  });
});

describe("applyRetention — total-byte cap (#956)", () => {
  it("evicts from the tail until total ≤ CHECKPOINT_TOTAL_BYTE_LIMIT", () => {
    // 10 × 700 KB = 7 MB (> 5 MiB cap). Each on its own anchor so the
    // per-anchor cap never fires — we want to isolate the byte path.
    const big = 700_000;
    const input = Array.from({ length: 10 }, (_, i) =>
      makeCheckpoint(i, { filePath: `/${i}.md`, byteSize: big }),
    );
    useMcpStore.getState().checkpointSetAll(input);

    const retained = currentCheckpoints();
    const total = retained.reduce((sum, cp) => sum + cp.byteSize, 0);
    expect(total).toBeLessThanOrEqual(CHECKPOINT_TOTAL_BYTE_LIMIT);
    // 5 MiB / 700 KB ≈ 7.49 → 7 entries fit (4.9 MB), the 8th tips it over.
    expect(retained.length).toBe(7);
    // Eviction is from the end, so the front of the list survives.
    expect(retained[0].id).toBe("cp-0");
  });

  it("applies the per-anchor cap first, then the total-byte cap", () => {
    // 60 × 100 KB checkpoints on the same anchor:
    //   - per-anchor cap trims to 50 (5 MB)
    //   - byte cap: 50 × 100 KB = 5 000 000 B > 5 242 880 B? No,
    //     5 MiB = 5 242 880, so 5 000 000 stays under. No further trim.
    // Bump byteSize so the byte cap also fires after the per-anchor trim.
    const input = Array.from({ length: 60 }, (_, i) =>
      makeCheckpoint(i, { filePath: "/big.md", byteSize: 200_000 }),
    );
    useMcpStore.getState().checkpointSetAll(input);

    const retained = currentCheckpoints();
    const total = retained.reduce((sum, cp) => sum + cp.byteSize, 0);
    expect(retained.length).toBeLessThanOrEqual(CHECKPOINT_PER_ANCHOR_LIMIT);
    expect(total).toBeLessThanOrEqual(CHECKPOINT_TOTAL_BYTE_LIMIT);
    // 5 MiB / 200 KB = 26.21 → 26 entries fit (5.2 MB), the 27th tips it.
    // After per-anchor cap drops to 50, byte cap drops 50→26.
    expect(retained.length).toBe(26);
  });
});

describe("applyRetention — empty input (#956)", () => {
  it("returns an empty list when given an empty list", () => {
    useMcpStore.getState().checkpointSetAll([]);
    expect(currentCheckpoints()).toEqual([]);
  });
});
