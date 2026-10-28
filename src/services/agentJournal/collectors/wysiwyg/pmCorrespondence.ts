/**
 * Block correspondence — which top-level blocks of the current document are
 * provably the same, unchanged blocks of the anchored one.
 *
 * Key decisions:
 *   - A current block pairs with an anchored block only when both witnesses
 *     agree: its edges map back through the inverse of every observed step
 *     map to the start and end of an anchored top-level child that IS the
 *     same immutable node object, and no range touched by any observed step
 *     (empty-map mark and attribute steps included) lies inside it.
 *   - Block counts, types or text never pair anything; pairs ascend in both
 *     documents.
 *   - One budget, `MAX_RANGE_MAPPINGS`, bounds every position mapping:
 *     carrying the touched ranges forward, and mapping each candidate
 *     block's two edges back through every step map. It is charged before
 *     the work; past it nothing is paired (`null`) and the window is a
 *     capped whole-document break.
 *
 * @coordinates-with services/agentJournal/collectors/wysiwyg/txnLedger.ts — the edges
 * @coordinates-with services/agentJournal/collectors/wysiwyg/blockMap.ts — the consumer
 * @module services/agentJournal/collectors/wysiwyg/pmCorrespondence
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Mapping } from "@tiptap/pm/transform";
import { MAX_RANGE_MAPPINGS, mergeRanges, type Range } from "./pmSteps";
import type { Edge } from "./txnLedger";

/** Ascending in both documents: [anchored index, current index]. */
export type BlockPairs = readonly (readonly [number, number])[];

/** Every edge's touched ranges, carried forward to the current document's coordinates, and the mappings spent; `null` past `budget`. */
function touchedInHead(edges: readonly Edge[], budget: number): { ranges: Range[]; mappings: number } | null {
  let acc: Range[] = [];
  let mappings = 0;
  for (const edge of edges) {
    for (const map of edge.maps) {
      mappings += acc.length;
      if (mappings > budget) return null;
      acc = acc.map((r): Range => [map.map(r[0], -1), map.map(r[1], 1)]);
    }
    acc = mergeRanges([...acc, ...edge.touched]);
  }
  return { ranges: acc, mappings };
}

/** Does any range reach the open block interior (s, e)? Ranges are sorted and disjoint. */
function intersects(ranges: readonly Range[], s: number, e: number): boolean {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= s) lo = mid + 1;
    else hi = mid;
  }
  const r = ranges[lo];
  if (!r) return false;
  if (r[0] === r[1]) return r[0] > s && r[0] < e;
  return r[0] < e;
}

/** The blocks of `current` that are provably `anchored`'s, unchanged; `null` when proving it would cost past `budget`. */
export function correspond(anchored: PMNode, current: PMNode, edges: readonly Edge[], budget = MAX_RANGE_MAPPINGS): BlockPairs | null {
  const head = touchedInHead(edges, budget);
  if (head === null) return null;
  let mappings = head.mappings;
  const maps = edges.flatMap((e) => e.maps);
  const inverse = new Mapping(maps).invert();
  const starts = new Map<number, number>();
  anchored.forEach((_child, offset, index) => starts.set(offset, index));
  const pairs: [number, number][] = [];
  let offset = 0;
  for (let index = 0; index < current.childCount; index++) {
    const child = current.child(index);
    const s = offset;
    const e = offset + child.nodeSize;
    offset = e;
    if (intersects(head.ranges, s, e)) continue;
    // @edge-case Each edge maps back through every step map: many blocks
    // under many maps is block × map work, charged like the ranges above.
    mappings += 2 * maps.length;
    if (mappings > budget) return null;
    const s0 = maps.length ? inverse.map(s, 1) : s;
    const e0 = maps.length ? inverse.map(e, -1) : e;
    const i0 = starts.get(s0);
    if (i0 === undefined || e0 - s0 !== child.nodeSize || anchored.child(i0) !== child) continue;
    const prev = pairs[pairs.length - 1];
    if (prev && prev[0] >= i0) continue;
    pairs.push([i0, index]);
  }
  return pairs;
}
