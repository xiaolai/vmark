/**
 * The decoration-tree algorithm prosemirror-view 1.42.6 ships, before VMark's
 * patch — the reference the patched build must agree with exactly.
 *
 * Transcribed from upstream `src/decoration.ts` (`buildTree`,
 * `takeSpansForNode`, `addInner`, `forChild`), kept unoptimised on purpose: it
 * is the specification, not an implementation. It reaches the same internals
 * the library uses (`local`, `children`, the constructors, `type.valid`), which
 * is what lets a test compare whole trees with `eq` rather than a summary.
 */
import type { Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type Child = number | DecorationSet;
interface SetInternals {
  local: readonly Decoration[];
  children: readonly Child[];
}
interface DecorationInternals {
  type: { valid(node: Node, span: Decoration): boolean };
  inline: boolean;
}

const NewSet = DecorationSet as unknown as new (local: Decoration[], children: Child[]) => DecorationSet;
const NewDecoration = Decoration as unknown as new (from: number, to: number, type: unknown) => Decoration;
const parts = (set: DecorationSet) => set as unknown as SetInternals;
const internals = (span: Decoration) => span as unknown as DecorationInternals;
const empty = DecorationSet.empty;

function byPos(a: Decoration, b: Decoration): number {
  return a.from - b.from || a.to - b.to;
}

function takeSpansForNode(spans: (Decoration | null)[], node: Node, offset: number): Decoration[] | null {
  if (node.isLeaf) return null;
  const end = offset + node.nodeSize;
  let found: Decoration[] | null = null;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span && span.from > offset && span.to < end) {
      (found ??= []).push(span);
      spans[i] = null;
    }
  }
  return found;
}

function withoutNulls<T>(array: readonly (T | null)[]): T[] {
  return array.filter((value): value is T => value != null);
}

function moveSpans(spans: Decoration[], offset: number): Decoration[] {
  if (!offset || !spans.length) return spans;
  return spans.map((span) => new NewDecoration(span.from + offset, span.to + offset, internals(span).type));
}

function buildTree(spans: (Decoration | null)[], node: Node, offset: number): DecorationSet {
  const children: Child[] = [];
  let hasNulls = false;
  node.forEach((childNode, localStart) => {
    const found = takeSpansForNode(spans, childNode, localStart + offset);
    if (found) {
      hasNulls = true;
      const subtree = buildTree(found, childNode, offset + localStart + 1);
      if (subtree !== empty) children.push(localStart, localStart + childNode.nodeSize, subtree);
    }
  });
  const locals = moveSpans(hasNulls ? withoutNulls(spans) : (spans as Decoration[]), -offset).sort(byPos);
  for (let i = 0; i < locals.length; i++) if (!internals(locals[i]).type.valid(node, locals[i])) locals.splice(i--, 1);
  return locals.length || children.length ? new NewSet(locals, children) : empty;
}

/** `DecorationSet.create`, unpatched. Consumes `decorations`, as the library's does. */
export function referenceCreate(doc: Node, decorations: Decoration[]): DecorationSet {
  return decorations.length ? buildTree(decorations, doc, 0) : empty;
}

function addInner(set: DecorationSet, doc: Node, decorations: (Decoration | null)[], offset: number): DecorationSet {
  let children: Child[] | undefined;
  let childIndex = 0;
  doc.forEach((childNode, childOffset) => {
    const baseOffset = childOffset + offset;
    const found = takeSpansForNode(decorations, childNode, baseOffset);
    if (!found) return;
    children ??= parts(set).children.slice();
    while (childIndex < children.length && (children[childIndex] as number) < childOffset) childIndex += 3;
    if (children[childIndex] === childOffset) {
      children[childIndex + 2] = addInner(children[childIndex + 2] as DecorationSet, childNode, found, baseOffset + 1);
    } else {
      children.splice(childIndex, 0, childOffset, childOffset + childNode.nodeSize, buildTree(found, childNode, baseOffset + 1));
    }
    childIndex += 3;
  });
  const local = moveSpans(childIndex ? withoutNulls(decorations) : (decorations as Decoration[]), -offset);
  for (let i = 0; i < local.length; i++) if (!internals(local[i]).type.valid(doc, local[i])) local.splice(i--, 1);
  const { local: own, children: ownChildren } = parts(set);
  return new NewSet(local.length ? own.concat(local).sort(byPos) : (own as Decoration[]), children ?? (ownChildren as Child[]));
}

/** `DecorationSet.prototype.add`, unpatched. Consumes `decorations`. */
export function referenceAdd(set: DecorationSet, doc: Node, decorations: Decoration[]): DecorationSet {
  if (!decorations.length) return set;
  if (set === empty) return referenceCreate(doc, decorations);
  return addInner(set, doc, decorations, 0);
}

/**
 * `DecorationSet.prototype.forChild`, unpatched, as its two parts: the child
 * set at `offset` and the inline decorations cut to the child. The library
 * returns them as one set, or as a group of `[local, child]` when both exist.
 */
export function referenceForChild(
  set: DecorationSet,
  offset: number,
  node: Node,
): { child: DecorationSet | undefined; local: DecorationSet | undefined } {
  if (set === empty || node.isLeaf) return { child: undefined, local: undefined };
  const { children, local: own } = parts(set);
  let child: DecorationSet | undefined;
  for (let i = 0; i < children.length; i += 3) {
    if ((children[i] as number) >= offset) {
      if (children[i] === offset) child = children[i + 2] as DecorationSet;
      break;
    }
  }
  const start = offset + 1;
  const end = start + node.content.size;
  const local: Decoration[] = [];
  for (const dec of own) {
    if (dec.from < end && dec.to > start && internals(dec).inline) {
      const from = Math.max(start, dec.from) - start;
      const to = Math.min(end, dec.to) - start;
      if (from < to) local.push(new NewDecoration(from, to, internals(dec).type));
    }
  }
  return { child, local: local.length ? new NewSet(local.sort(byPos), []) : undefined };
}
