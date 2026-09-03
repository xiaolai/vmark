/**
 * Agent perception — page snapshot and role/name locators (WI-2.2), the
 * TypeScript mirror of the injected agent library.
 *
 * Purpose: how the AI *sees* and *targets* a page. `ariaSnapshot` renders the
 * interactive/structural elements as compact `{role, name, …}` nodes the model
 * reads; `queryByRole` resolves a role+accessible-name locator back to elements
 * to act on. Role+name targeting is preferred over CSS/XPath because it is
 * self-describing and resilient to markup churn (the Playwright/ARIA approach).
 * Role inference lives in `ariaRole.ts`, name computation in `ariaName.ts`; both
 * are re-exported here so consumers keep one import.
 *
 * Leaf-pure DOM logic — no store, no Tauri — so it is jsdom-unit-testable. It is
 * NOT what runs in the page: that is `agentCore.src.js` + `agentLib.ts`, and
 * this mirror cannot eval that asset (VMark's webview CSP carries no
 * 'unsafe-eval'). `ariaParity.test.ts` and `actScript.test.ts` are the contract
 * that keeps the two the same algorithm.
 *
 * Key decisions:
 *   - Hidden elements (and their subtrees) are never perceived or targeted: a
 *     hidden duplicate of a control would otherwise shadow the real one. `inert`
 *     counts as hidden for PERCEPTION (an inert subtree is not in the a11y tree);
 *     the act path distinguishes it (S-04).
 *   - The walk is the COMPOSED tree: an element, then its open shadow tree, then
 *     its light children (S-05) — so web components are perceived, in the same
 *     order the injected `__vmarkAll` produces.
 *   - State (checked/disabled) is read from the LIVE DOM (property, `:disabled`),
 *     not from the initial attributes, which never move after user interaction.
 *   - The snapshot is bounded (S-06): at most `SNAPSHOT_NODE_CAP` nodes, names at
 *     most `NAME_CAP` chars; the injected shape says when either cap bit.
 *
 * Known limitations: hiding via a stylesheet rule (rather than `hidden`,
 * `aria-hidden`, `inert`, or an inline style) is not detected — that needs layout,
 * which jsdom does not have; `aria-checked="mixed"` collapses to `false`; a CLOSED
 * shadow root is invisible by definition.
 *
 * @coordinates-with lib/browser/agent/agentCore.src.js, agentLib.ts — the injected copy of
 *   these rules; `actScript.test.ts` asserts the two perceive a page identically
 * @coordinates-with lib/browser/agent/refs.ts — the per-node stable ref store
 * @module lib/browser/agent/aria
 */

import { refFor } from "./refs";
import { computeRole, HEADING_TAGS } from "./ariaRole";
import { accessibleName, selfHidden } from "./ariaName";

export { computeRole, accessibleName };

/** A compact accessibility node for the AI to read. */
export interface AriaNode {
  role: string;
  name: string;
  /** Stable handle for this element within the committed page (WI-P2.1). `act`
   *  can target `{ref}` exactly instead of re-resolving a fuzzy role + name. */
  ref: string;
  /** Heading level (1–6), when `role === "heading"`. */
  level?: number;
  /** Checked state, when `role` is checkbox/radio. */
  checked?: boolean;
  /** Disabled state, when applicable. */
  disabled?: boolean;
  /** A file input (S-10): perceivable so the model can name it, never actable —
   *  uploads are refused with `reason:'upload'` and are never permitted. */
  upload?: boolean;
}

/** What `buildSnapshotScript` returns (S-05 / S-06): the nodes, whether a cap
 *  bit (2000 nodes or a 200-char name), and what the composed walk could not enter. */
export interface AriaSnapshot {
  nodes: AriaNode[];
  truncated: boolean;
  unreachable: {
    /** Custom-element hosts exposing no open shadow root — where a closed root can
     *  hide. A closed root is undetectable, so this is a proxy, not a count. */
    closedShadowRoots: number;
    /** `<iframe>`/`<frame>` elements: evals target the main frame only. */
    frames: number;
  };
}

/** Snapshot node cap (S-06). */
export const SNAPSHOT_NODE_CAP = 2000;

/** Composed-tree parent: the parent element, or the host of the shadow root `n`
 *  is a top-level child of. Mirrors `__vmarkParent`. */
function composedParent(n: Element): Element | null {
  if (n.parentElement) return n.parentElement;
  const host = (n.parentNode as ShadowRoot | null)?.host;
  return host && host.nodeType === 1 ? host : null;
}

/** Why `el` is not perceivable — 'hidden' outranks 'inert'. Mirrors `__vmarkHiddenBy`. */
function hiddenBy(el: Element): "hidden" | "inert" | null {
  let inert = false;
  for (let node: Element | null = el; node !== null; node = composedParent(node)) {
    if (selfHidden(node)) return "hidden";
    if (node.hasAttribute("inert")) inert = true;
  }
  return inert ? "inert" : null;
}

/**
 * Is `el` (or any composed ancestor) hidden from the accessibility tree?
 *
 * A hidden element is not perceivable, so it must be neither snapshotted nor
 * targeted — a hidden duplicate of "Publish" would otherwise shadow the visible
 * one and the agent would act on nothing while reporting success.
 */
function isHidden(el: Element): boolean {
  return hiddenBy(el) !== null;
}

/** Every element under `root` (excluded) in composed pre-order — mirrors `__vmarkAll`. */
/** Elements a snapshot may visit before it stops looking. Distinct from the
 *  NODE cap on the output: that only bounded what was emitted, while the whole
 *  hostile-page DOM was still materialized as an array first. */
const SNAPSHOT_VISIT_BUDGET = 50_000;

function* composedDescendants(root: ParentNode): Generator<Element> {
  let visited = 0;
  const stack: Element[] = [];
  const push = (node: ParentNode): void => {
    const kids = node.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  };
  push(root);
  while (stack.length) {
    const el = stack.pop()!;
    visited += 1;
    if (visited > SNAPSHOT_VISIT_BUDGET) return;
    yield el;
    push(el);
    if (el.shadowRoot) push(el.shadowRoot);
  }
}

function nameMatches(actual: string, wanted: string, exact: boolean): boolean {
  return exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase());
}

/** Find every visible element with the given role, optionally filtered by
 *  accessible name (exact by default; substring when `exact: false`). Composed
 *  document order. Hidden elements are never returned. */
export function queryByRole(
  root: Element,
  role: string,
  opts: { name?: string; exact?: boolean } = {},
): Element[] {
  const exact = opts.exact !== false;
  return [...composedDescendants(root)].filter(
    (el) =>
      computeRole(el) === role &&
      !isHidden(el) &&
      (opts.name === undefined || nameMatches(accessibleName(el), opts.name, exact)),
  );
}

/** Effective disabled state — including inherited disablement (a control inside a
 *  disabled `<fieldset>`), which no attribute on the element itself records. */
function isDisabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.matches(":disabled")) return true;
  // Custom controls (`<div role="button" disabled>`) that `:disabled` never matches.
  return el.hasAttribute("disabled");
}

/** Checked state from the LIVE property — the `checked` attribute records only the
 *  INITIAL state and never moves when the user clicks. */
function isChecked(el: Element): boolean {
  if (el.tagName === "INPUT") return (el as HTMLInputElement).checked;
  return el.getAttribute("aria-checked") === "true";
}

function isFileInput(el: Element): boolean {
  return el.tagName.toLowerCase() === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "file";
}

/** Render the page's interesting, visible elements as a flat list of accessibility
 *  nodes (generic containers with no role, and hidden subtrees, are omitted),
 *  capped at `SNAPSHOT_NODE_CAP`. */
export function ariaSnapshot(root: Element, generation = 0): AriaNode[] {
  const nodes: AriaNode[] = [];
  for (const el of composedDescendants(root)) {
    const role = computeRole(el);
    if (!role || isHidden(el)) continue;
    if (nodes.length >= SNAPSHOT_NODE_CAP) break;
    const node: AriaNode = { role, name: accessibleName(el), ref: refFor(el, generation) };
    const level = HEADING_TAGS[el.tagName.toLowerCase()];
    if (role === "heading") node.level = level ?? (Number(el.getAttribute("aria-level")) || undefined);
    if (role === "checkbox" || role === "radio") node.checked = isChecked(el);
    if (isDisabled(el)) node.disabled = true;
    if (isFileInput(el)) node.upload = true;
    nodes.push(node);
  }
  return nodes;
}
