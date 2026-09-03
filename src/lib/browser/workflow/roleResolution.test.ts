// @vitest-environment node
// Audit 2026-09-03 S-02 / W10 — a role-less `click "name"` must not become an
// unmatchable `role:""` query. The role is resolved from a fresh snapshot:
// exactly one roled node with that name → its role; none → not found; several
// roles → ambiguous (stop and ask, never a coin flip).
import { describe, expect, it } from "vitest";
import { parseSnapshotResult, resolveRoleByName } from "./roleResolution";

const read = (nodes: Array<[string, string]>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ nodes: nodes.map(([role, name], i) => ({ role, name, ref: `e${i}` })), truncated: false, unreachable: 0, ...extra });

describe("parseSnapshotResult", () => {
  it("reads the {nodes, truncated, unreachable} shape", () => {
    const r = parseSnapshotResult(read([["button", "Go"]], { truncated: true, unreachable: 2 }));
    expect(r).toEqual({ nodes: [{ role: "button", name: "Go", ref: "e0" }], truncated: true, unreachable: true });
  });

  it("treats a boolean, a count, and a list as the unreachable signal; falsy forms as none", () => {
    expect(parseSnapshotResult(read([], { unreachable: true }))!.unreachable).toBe(true);
    expect(parseSnapshotResult(read([], { unreachable: ["iframe"] }))!.unreachable).toBe(true);
    expect(parseSnapshotResult(read([], { unreachable: 0 }))!.unreachable).toBe(false);
    expect(parseSnapshotResult(read([], { unreachable: [] }))!.unreachable).toBe(false);
    expect(parseSnapshotResult(read([], { unreachable: false }))!.unreachable).toBe(false);
    expect(parseSnapshotResult(JSON.stringify({ nodes: [] }))!.unreachable).toBe(false);
  });

  it("still accepts the legacy bare-array encoding (the nodes themselves)", () => {
    const r = parseSnapshotResult(JSON.stringify([{ role: "link", name: "Home", ref: "e0" }]));
    expect(r).toEqual({ nodes: [{ role: "link", name: "Home", ref: "e0" }], truncated: false, unreachable: false });
  });

  it("drops malformed nodes and returns null for an unusable payload", () => {
    const r = parseSnapshotResult(JSON.stringify({ nodes: [{ role: "button", name: "Go" }, null, { role: 5 }, "x"] }));
    expect(r!.nodes).toEqual([{ role: "button", name: "Go" }]);
    expect(parseSnapshotResult("not json")).toBeNull();
    expect(parseSnapshotResult(JSON.stringify({ nodes: "nope" }))).toBeNull();
    expect(parseSnapshotResult(JSON.stringify(null))).toBeNull();
    expect(parseSnapshotResult(JSON.stringify("<timeout>"))).toBeNull();
  });
});

describe("resolveRoleByName", () => {
  it("resolves the one role that carries the name", () => {
    const snap = parseSnapshotResult(read([["button", "Publish"], ["link", "Home"], ["button", "Publish"]]))!;
    expect(resolveRoleByName(snap, "Publish")).toEqual({ kind: "resolved", role: "button" });
  });

  it("is exact on the name — a decorated or differently cased name is not a match", () => {
    const snap = parseSnapshotResult(read([["button", "Publish now"], ["button", "publish"]]))!;
    expect(resolveRoleByName(snap, "Publish")).toEqual({ kind: "none" });
  });

  it("reports several roles as ambiguous, listing them", () => {
    const snap = parseSnapshotResult(read([["link", "Publish"], ["button", "Publish"], ["menuitem", "Publish"]]))!;
    expect(resolveRoleByName(snap, "Publish")).toEqual({ kind: "ambiguous", roles: ["link", "button", "menuitem"] });
  });

  it("a miss on a truncated or partly unreachable snapshot is unusable, not a confident 'none'", () => {
    const truncated = parseSnapshotResult(read([["button", "Other"]], { truncated: true }))!;
    expect(resolveRoleByName(truncated, "Publish")).toEqual({ kind: "unusable", reason: "snapshot-truncated" });
    const unreachable = parseSnapshotResult(read([["button", "Other"]], { unreachable: 1 }))!;
    expect(resolveRoleByName(unreachable, "Publish")).toEqual({ kind: "unusable", reason: "snapshot-unreachable" });
  });

  it("a hit on a truncated snapshot still resolves (the control was seen)", () => {
    const snap = parseSnapshotResult(read([["button", "Publish"]], { truncated: true }))!;
    expect(resolveRoleByName(snap, "Publish")).toEqual({ kind: "resolved", role: "button" });
  });
});
