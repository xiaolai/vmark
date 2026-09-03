/**
 * Role resolution for a role-less locator (audit 2026-09-03 S-02 / W10).
 *
 * The recorder may emit `click "name"` with no role, and a workflow author may
 * write one. The act scripts resolve a target by role + name, so a missing role
 * used to become `role:""` — a query that matches nothing, a step that fails on
 * every replay, and a heal that never crosses roles. Instead the executor reads a
 * fresh snapshot and resolves the role here BEFORE authorising the act, so the
 * approval prompt names a real control:
 *
 *   - exactly one role carries the name → that role;
 *   - no node carries it → `none` (the ordinary not-found path) — unless the
 *     snapshot was truncated or part of the page was unreachable (shadow DOM,
 *     iframes), in which case a miss proves nothing and the answer is `unusable`
 *     (stop and ask);
 *   - several roles carry it → `ambiguous` (stop and ask; never a coin flip).
 *
 * `parseSnapshotResult` reads the snapshot script's `{nodes, truncated,
 * unreachable}` result. The legacy bare-array encoding is accepted too — it is
 * unambiguously the node list, and refusing it would turn a benign encoding
 * difference into a silent "nothing found".
 *
 * Leaf-pure.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — `buildSnapshotScript` produces the JSON
 * @coordinates-with services/workflow/runExecutor.ts — the consumer
 * @module lib/browser/workflow/roleResolution
 */
import type { SnapshotNode } from "./selfHeal";

export interface SnapshotRead {
  nodes: SnapshotNode[];
  /** The script hit its node cap; a control may exist beyond it. */
  truncated: boolean;
  /** Part of the page (shadow roots, frames) could not be walked. */
  unreachable: boolean;
}

export type RoleResolution =
  | { kind: "resolved"; role: string }
  | { kind: "none" }
  | { kind: "ambiguous"; roles: string[] }
  | { kind: "unusable"; reason: "snapshot-truncated" | "snapshot-unreachable" };

/** The script may report `unreachable` as a boolean, a count, or a list of what it
 *  could not walk; an empty list or a zero count means nothing was missed. */
function hasUnreachable(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value === true;
}

function toNodes(value: unknown): SnapshotNode[] | null {
  if (!Array.isArray(value)) return null;
  const out: SnapshotNode[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.role !== "string" || typeof e.name !== "string") continue;
    out.push(entry as SnapshotNode);
  }
  return out;
}

/** Parse a snapshot eval result, or null when it is not a snapshot at all. */
export function parseSnapshotResult(raw: string): SnapshotRead | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const nodes = toNodes(parsed);
    return nodes ? { nodes, truncated: false, unreachable: false } : null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const nodes = toNodes(obj.nodes);
  if (!nodes) return null;
  return { nodes, truncated: obj.truncated === true, unreachable: hasUnreachable(obj.unreachable) };
}

/** Resolve the role of the control(s) named exactly `name`. */
export function resolveRoleByName(snapshot: SnapshotRead, name: string): RoleResolution {
  const roles: string[] = [];
  for (const node of snapshot.nodes) {
    if (node.name !== name || roles.includes(node.role)) continue;
    roles.push(node.role);
  }
  if (roles.length === 1) return { kind: "resolved", role: roles[0] };
  if (roles.length > 1) return { kind: "ambiguous", roles };
  if (snapshot.truncated) return { kind: "unusable", reason: "snapshot-truncated" };
  if (snapshot.unreachable) return { kind: "unusable", reason: "snapshot-unreachable" };
  return { kind: "none" };
}
