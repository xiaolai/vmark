/**
 * Extension resolver — ADR-015 D1, WI-1.2.
 *
 * Purpose: turn an authoring-time tree of extension groups into the single
 * ordered composition the app runs. This is the ONLY path to composition; if a
 * feature did not produce a descriptor, it does not exist.
 *
 * Pipeline: flatten groups → dedupe by id → validate requirements and ordering
 * references → topologically sort → report cycles.
 *
 * Key decisions:
 *   - Dedup is by `id`, not object identity. Composition builds values inline
 *     (`StarterKit.configure(...)`), so factory calls yield fresh objects and
 *     identity dedup would silently admit duplicates.
 *   - The SAME descriptor object included twice is fine — that is grouping
 *     overlap, exactly what CodeMirror's dedup exists to permit. Two DIFFERENT
 *     descriptors claiming one id is an error.
 *   - `requires` implies ordering: a requirement is placed before its dependent,
 *     so features need not restate the dependency as an `after` constraint.
 *   - Ordering is a stable topological sort. Constraints are HARD; bucket then
 *     registration order is only the tie-break. So a `before` may pull an
 *     extension out of its preferred bucket — the explicit pairwise statement
 *     beats the coarse preference.
 *   - A dangling `before`/`after` reference is an error, not a no-op. A typo'd
 *     constraint that quietly does nothing is how ordering bugs survive.
 *   - On any error the ordering is EMPTY. A partial order would be a plausible
 *     composition that silently omits things — the failure mode this whole ADR
 *     exists to prevent.
 *
 * @coordinates-with lib/extensions/types.ts — the descriptor contract
 * @module lib/extensions/resolve
 */
import {
  PREC_ORDER,
  type ExtensionGroup,
  type ExtensionId,
  type Resolution,
  type ResolutionError,
  type VMarkExtension,
} from "./types";

/** Flatten an arbitrarily nested group into registration order. */
function flatten(group: ExtensionGroup, into: VMarkExtension[]): void {
  if (Array.isArray(group)) {
    for (const child of group) flatten(child as ExtensionGroup, into);
    return;
  }
  into.push(group as VMarkExtension);
}

/** Rank of an extension's precedence bucket; unset means `default`. */
function bucketRank(extension: VMarkExtension): number {
  const bucket = extension.ordering?.bucket ?? "default";
  const rank = PREC_ORDER.indexOf(bucket);
  return rank === -1 ? PREC_ORDER.indexOf("default") : rank;
}

/**
 * Resolve a group into ordered composition.
 *
 * Never throws — callers get a `Resolution` whose `errors` are exhaustive, so a
 * single bad descriptor does not mask the rest.
 */
export function resolveExtensions(group: ExtensionGroup): Resolution {
  const errors: ResolutionError[] = [];
  const flat: VMarkExtension[] = [];
  flatten(group, flat);

  // ---- dedupe by id -------------------------------------------------------
  const byId = new Map<ExtensionId, VMarkExtension>();
  const order: VMarkExtension[] = [];

  for (const extension of flat) {
    // The `never throws` contract must survive a malformed leaf. A well-typed
    // caller cannot pass a non-descriptor, but a JS/third-party caller can, and
    // `extension.id` on null would throw rather than report.
    if (extension === null || typeof extension !== "object") {
      errors.push({
        code: "invalid-descriptor",
        message: `Extension descriptor is not an object: ${String(extension)}.`,
        ids: [],
      });
      continue;
    }
    if (!extension.id) {
      errors.push({
        code: "empty-id",
        message: "Extension has an empty id; every extension needs a stable name.",
        ids: [],
      });
      continue;
    }
    const existing = byId.get(extension.id);
    if (existing === undefined) {
      byId.set(extension.id, extension);
      order.push(extension);
      continue;
    }
    // Same object twice is grouping overlap, which is legal and free.
    if (existing !== extension) {
      errors.push({
        code: "duplicate-id",
        message:
          `Two different extensions both claim id \`${extension.id}\`. ` +
          "Ids are a flat global namespace; rename one.",
        ids: [extension.id],
      });
    }
  }

  // ---- validate references ------------------------------------------------
  const index = new Map<ExtensionId, number>();
  order.forEach((extension, i) => index.set(extension.id, i));

  for (const extension of order) {
    for (const required of extension.requires ?? []) {
      if (required === extension.id) {
        errors.push({
          code: "self-reference",
          message: `\`${extension.id}\` requires itself; a self-dependency is unsatisfiable.`,
          ids: [extension.id],
        });
      } else if (!byId.has(required)) {
        errors.push({
          code: "missing-requirement",
          message: `\`${extension.id}\` requires \`${required}\`, which is not registered.`,
          ids: [extension.id, required],
        });
      }
    }
    for (const ref of [
      ...(extension.ordering?.before ?? []),
      ...(extension.ordering?.after ?? []),
    ]) {
      if (ref === extension.id) {
        // `a before a` / `a after a` is a self-loop — an unsatisfiable
        // constraint that the graph builder silently drops. Flag it instead.
        errors.push({
          code: "self-reference",
          message: `\`${extension.id}\` orders itself against itself; remove the self-constraint.`,
          ids: [extension.id],
        });
      } else if (!byId.has(ref)) {
        errors.push({
          code: "unknown-ordering-ref",
          message:
            `\`${extension.id}\` orders itself against \`${ref}\`, which is not ` +
            "registered. A constraint that silently does nothing hides ordering bugs.",
          ids: [extension.id, ref],
        });
      }
    }
  }

  if (errors.length > 0) return { ordered: [], errors };

  // ---- build the constraint graph ----------------------------------------
  // Edge a → b means "a must come before b".
  const edges = new Map<ExtensionId, Set<ExtensionId>>();
  const indegree = new Map<ExtensionId, number>();
  for (const extension of order) {
    edges.set(extension.id, new Set());
    indegree.set(extension.id, 0);
  }

  const addEdge = (from: ExtensionId, to: ExtensionId): void => {
    const outgoing = edges.get(from);
    if (outgoing === undefined || outgoing.has(to) || from === to) return;
    outgoing.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const extension of order) {
    for (const required of extension.requires ?? []) addEdge(required, extension.id);
    for (const before of extension.ordering?.before ?? []) addEdge(extension.id, before);
    for (const after of extension.ordering?.after ?? []) addEdge(after, extension.id);
  }

  // ---- stable topological sort -------------------------------------------
  // Ready nodes are taken by (bucket, registration index) so the result is
  // deterministic and, absent constraints, matches declaration order.
  const preference = (id: ExtensionId): [number, number] => {
    const extension = byId.get(id);
    return [
      extension === undefined ? 0 : bucketRank(extension),
      index.get(id) ?? 0,
    ];
  };

  const ready = order.filter((e) => (indegree.get(e.id) ?? 0) === 0).map((e) => e.id);
  const sorted: VMarkExtension[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => {
      const [bucketA, indexA] = preference(a);
      const [bucketB, indexB] = preference(b);
      return bucketA - bucketB || indexA - indexB;
    });
    const next = ready.shift() as ExtensionId;
    const extension = byId.get(next);
    if (extension !== undefined) sorted.push(extension);

    for (const target of edges.get(next) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }

  if (sorted.length !== order.length) {
    // The unsorted set is the cycle PLUS everything downstream of it. Extract
    // one actual closed cycle so both `ids` and the message name real cycle
    // members, not innocent nodes that merely depend on a cycle.
    const stuck = new Set(order.filter((e) => !sorted.includes(e)).map((e) => e.id));
    const cycle = findCycle(stuck, edges);
    errors.push({
      code: "ordering-cycle",
      message:
        "Ordering constraints form a cycle; no composition order exists. " +
        `Involved: ${[...cycle, cycle[0]].join(" → ")}`,
      ids: cycle,
    });
    return { ordered: [], errors };
  }

  return { ordered: sorted, errors };
}

/**
 * Extract one closed cycle from the stuck subgraph.
 *
 * A naive "walk until you revisit" can dead-end: a node that merely depends on a
 * cycle is also stuck but has no outgoing stuck-edge, so walking from it returns
 * a non-cycle tail. This uses DFS with a recursion stack instead — a cycle is
 * found only at a back-edge into a node currently on the stack, so the returned
 * path is always a genuine closed cycle regardless of where the search starts.
 * Node counts are tiny, so recursion depth is not a concern.
 */
function findCycle(
  stuck: ReadonlySet<ExtensionId>,
  edges: ReadonlyMap<ExtensionId, ReadonlySet<ExtensionId>>,
): ExtensionId[] {
  const visited = new Set<ExtensionId>();
  const onStack = new Set<ExtensionId>();
  const stack: ExtensionId[] = [];

  const dfs = (node: ExtensionId): ExtensionId[] | null => {
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!stuck.has(next)) continue;
      if (onStack.has(next)) {
        return stack.slice(stack.indexOf(next)); // back-edge → real cycle
      }
      if (!visited.has(next)) {
        const found = dfs(next);
        if (found !== null) return found;
      }
    }
    onStack.delete(node);
    stack.pop();
    return null;
  };

  for (const start of stuck) {
    if (!visited.has(start)) {
      const found = dfs(start);
      if (found !== null) return found;
    }
  }
  return [...stuck]; // defensive; a stuck set always contains a cycle
}
