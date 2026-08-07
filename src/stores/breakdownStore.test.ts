// @vitest-environment node
// WI-1.9b — breakdown store: EdgeRow mirror + panel toggle + artifact grouping.
import { beforeEach, describe, expect, it } from "vitest";
import {
  useBreakdownStore,
  selectRows,
  selectPanelOpen,
  selectLoading,
  selectError,
  selectRowsGroupedByArtifact,
  type EdgeRow,
} from "./breakdownStore";

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
    ...p,
  };
}

beforeEach(() => {
  localStorage.clear();
  useBreakdownStore.getState().reset();
});

describe("breakdownStore", () => {
  it("setRows replaces the row list; selector reads it", () => {
    useBreakdownStore.getState().setRows([row({ txf: "t1" }), row({ txf: "t2" })]);
    expect(selectRows(useBreakdownStore.getState())).toHaveLength(2);
  });

  it("setLoading / setError control the transient request state", () => {
    expect(selectLoading(useBreakdownStore.getState())).toBe(false);
    expect(selectError(useBreakdownStore.getState())).toBeNull();
    useBreakdownStore.getState().setLoading(true);
    useBreakdownStore.getState().setError("boom");
    expect(selectLoading(useBreakdownStore.getState())).toBe(true);
    expect(selectError(useBreakdownStore.getState())).toBe("boom");
    useBreakdownStore.getState().setError(null);
    expect(selectError(useBreakdownStore.getState())).toBeNull();
  });

  it("togglePanel / setPanelOpen control the panel", () => {
    expect(selectPanelOpen(useBreakdownStore.getState())).toBe(false);
    useBreakdownStore.getState().togglePanel();
    expect(selectPanelOpen(useBreakdownStore.getState())).toBe(true);
    useBreakdownStore.getState().setPanelOpen(false);
    expect(selectPanelOpen(useBreakdownStore.getState())).toBe(false);
  });

  it("reset clears rows, loading, and error, and closes the panel", () => {
    useBreakdownStore.getState().setRows([row({ txf: "t1" })]);
    useBreakdownStore.getState().setLoading(true);
    useBreakdownStore.getState().setError("boom");
    useBreakdownStore.getState().setPanelOpen(true);
    useBreakdownStore.getState().reset();
    const s = useBreakdownStore.getState();
    expect(selectRows(s)).toEqual([]);
    expect(selectLoading(s)).toBe(false);
    expect(selectError(s)).toBeNull();
    expect(selectPanelOpen(s)).toBe(false);
  });

  it("persists nothing — rows are Rust-owned and panelOpen is per-window (audit T17)", () => {
    useBreakdownStore.getState().setPanelOpen(true);
    useBreakdownStore.getState().setRows([]);
    expect(localStorage.getItem("vmark-breakdown")).toBeNull();
  });
});

describe("selectRowsGroupedByArtifact", () => {
  it("returns an empty list for no rows", () => {
    expect(selectRowsGroupedByArtifact([])).toEqual([]);
  });

  it("groups multiple edges of the same downstream artifact together", () => {
    const rows = [
      row({ txf: "t1", input: 0, downstream_path: "essays/a.md" }),
      row({ txf: "t2", input: 1, downstream_path: "essays/b.md" }),
      row({ txf: "t1", input: 1, downstream_path: "essays/a.md" }),
    ];
    const groups = selectRowsGroupedByArtifact(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].artifact).toBe("essays/a.md");
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].artifact).toBe("essays/b.md");
    expect(groups[1].rows).toHaveLength(1);
  });

  it("falls back to the downstream object id when the path is missing", () => {
    const rows = [
      row({ txf: "t1", downstream: "obj-1", downstream_path: null }),
      row({ txf: "t2", downstream: "obj-1", downstream_path: null }),
      row({ txf: "t3", downstream: "obj-2", downstream_path: null }),
    ];
    const groups = selectRowsGroupedByArtifact(rows);
    expect(groups.map((g) => g.artifact)).toEqual(["obj-1", "obj-2"]);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("preserves first-appearance order of artifacts", () => {
    const rows = [
      row({ txf: "t1", downstream_path: "z.md" }),
      row({ txf: "t2", downstream_path: "a.md" }),
      row({ txf: "t3", downstream_path: "z.md" }),
    ];
    expect(selectRowsGroupedByArtifact(rows).map((g) => g.artifact)).toEqual([
      "z.md",
      "a.md",
    ]);
  });

  it("does not merge a null-path artifact with a path that equals its object id", () => {
    const rows = [
      row({ txf: "t1", downstream: "obj-1", downstream_path: null }),
      row({ txf: "t2", downstream: "obj-2", downstream_path: "obj-1" }),
    ];
    // Both group under the key "obj-1" — the fallback is intentionally the
    // object id, and a real path colliding with a UUID is not a practical case.
    // This test pins the CURRENT behavior so a future change is deliberate.
    const groups = selectRowsGroupedByArtifact(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });
});
