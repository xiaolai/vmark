/**
 * Injected agent act-scripts (WI-2.3 — macOS synthetic interaction tier).
 *
 * Purpose: generate the self-contained JS the driver evaluates (via `browser_eval`,
 * WI-2.1) in the page's isolated world to *read* (snapshot) and *act* (click/type)
 * by ARIA role + accessible name. On macOS the synthetic tier IS eval-dispatched
 * DOM events (SPIKE-3 found synthesized NSEvents don't deliver; trusted input is
 * Windows/CDP). The scripts must run standalone in the page — no bundler, no
 * imports — so the role/name logic is inlined in `agentLib.ts` (split out for
 * the file-size gate) as a copy of `agent/aria.ts`.
 *
 * **The copy is contract-tested, not trusted.** `actScript.test.ts` runs this
 * library against fixtures and asserts its snapshot is byte-identical to
 * `ariaSnapshot()`'s. Any drift between what the AI is unit-tested to see and what
 * it actually sees on a page fails that test.
 *
 * Every builder returns a script ending in `return JSON.stringify(...)`, matching
 * how `callAsyncJavaScript` awaits a result. Locating never crosses role
 * boundaries, so "click the button named Publish" can't hit a same-named link, and
 * an act that could not be performed reports `{clicked:false, reason}` rather than
 * a false success.
 *
 * Acts verify their EFFECT before reporting it (WI-NB1.1): the target is scrolled
 * into view, must be visibly rendered (computed styles + a collapsed-ancestor walk
 * stopping before `<body>`), and the click point is hit-tested via
 * `elementFromPoint` with `contains()` relatedness — an occluded target reports
 * `{reason:'obscured', by}` instead of clicking through. Role/name results carry
 * `matchedTotal`/`matchedVisible`. The layout-dependent checks self-disable where
 * no layout engine exists (jsdom), leaving the attribute tier;
 * `actScript.webkit.test.ts` exercises the rendered tier in real WebKit.
 *
 * The snapshot also stamps each node with a stable `ref` (WI-P2.1); the injected
 * ref store (`LIB_REFS`) mirrors `refs.ts` on the same `document.__vmarkRefStore`,
 * so the two agree and `actScript.test.ts` keeps them from drifting.
 *
 * Audit 2026-09-03: every walk is the COMPOSED tree through open shadow roots
 * (S-05); the snapshot is an object `{nodes, truncated, unreachable}` (S-05/S-06);
 * a role/name that resolves to more than one interactable element is refused as
 * `ambiguous` with ref'd `candidates` instead of clicking the first in DOM order
 * (S-03); `offscreen`, `disabled`+`detail:'inert'`, `upload` and `rejected-value`
 * are the new refusals (S-04/S-08/S-10). The role/name builders take an optional
 * `generation` so candidate refs are minted in the tab's store; without one they
 * are minted against the store's live generation, never resetting it. A wait
 * condition is a discriminated union (`{ref}` | `{role, name?}` | `{text}`) and
 * the builder refuses any non-string field rather than embed it (round 2, #93).
 *
 * @coordinates-with lib/browser/agent/aria.ts — same role/name/state/visibility rules
 * @coordinates-with lib/browser/agent/refs.ts — the mirrored per-node ref store
 * @coordinates-with src-tauri browser_eval — evaluates these scripts
 * @module lib/browser/agent/actScript
 */

import { AGENT_LIB } from "./agentLib";

// Re-exported so sibling injected-script modules (interactScript, powerScript)
// keep their import path.
export { AGENT_LIB };

/**
 * Script: read the page as a flat ARIA snapshot. `generation` scopes the ref
 * store, so refs reset across a navigation.
 *
 * Returns `JSON.stringify({nodes, truncated, unreachable})` (S-05 / S-06):
 *   - `nodes: [{role, name, ref, level?, checked?, disabled?, upload?}, …]` — at
 *     most 2000, in composed document order (an element, its open shadow tree,
 *     then its light children); `name` is at most 200 chars and is the exact
 *     string a `{role, name}` act matches; `upload:true` marks a file input,
 *     which is perceivable but never actable;
 *   - `truncated: boolean` — true when the node cap or a name cap bit;
 *   - `unreachable: {closedShadowRoots, frames}` — what the walk could not
 *     enter: `<iframe>`/`<frame>` elements (evals target the main frame), and
 *     custom-element hosts exposing no open shadow root (a closed root is
 *     undetectable, so this is the population where one can hide, not a count).
 * The TypeScript twin of a node is `AriaNode` / `AriaSnapshot` in `aria.ts`.
 */
export function buildSnapshotScript(generation = 0): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkSnapshot(${Number(generation)}));`;
}

/** `generation` for a role/name act: the tab's generation when the caller has
 *  it, else `null` so candidate refs are minted against the store's live one. */
function genArg(generation: number | undefined): string {
  return generation === undefined ? "null" : String(Number(generation));
}

/** Script: click the element with `role` + accessible `name` (exact). Reports
 *  `{found, clicked, matchedTotal, matchedVisible, reason?, detail?, by?,
 *  candidates?}`. Refusals: `disabled` (with `detail:'inert'` for an inert or
 *  pointer-events:none target), `hidden`, `ambiguous` (more than one interactable
 *  match — `candidates:[{ref,text}]` name them for a ref act under a standing
 *  grant), `upload` (a file input, or a click that would reach one), `offscreen`,
 *  `obscured` (+ `by`). Pass the tab's `generation` so candidate refs live in its
 *  ref store. */
export function buildClickScript(role: string, name: string, generation?: number): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkClick(${JSON.stringify(role)}, ${JSON.stringify(name)}, ${genArg(generation)}));`;
}

/** Script: replace the value of the field with `role` + `name` and fire
 *  input/change. Reports `{found, typed, matchedTotal, matchedVisible, reason?,
 *  detail?, candidates?}`. Refusals: `disabled` (+ `detail:'inert'`), `hidden`,
 *  `ambiguous`, `upload`, `readonly`, `not-editable`, `no-such-option`, and
 *  `rejected-value` when the engine sanitised the text away (the prior value is
 *  restored and no event fires). A contenteditable whose editor cancels
 *  `beforeinput` reports `typed:true, detail:'editor-handled'`. */
export function buildTypeScript(role: string, name: string, text: string, generation?: number): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkType(${JSON.stringify(role)}, ${JSON.stringify(name)}, ${JSON.stringify(text)}, ${genArg(generation)}));`;
}

/** Script: click the element bound to `ref` at `generation` (exact, order-
 *  independent). Resolves nothing — reports `{found:false}` — if the ref is stale
 *  (the store reset on navigation), so an old handle can never hit a new element.
 *  Same refusal vocabulary as `buildClickScript` minus `ambiguous` and the counts. */
export function buildClickByRefScript(ref: string, generation: number): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkClickRef(${JSON.stringify(ref)}, ${Number(generation)}));`;
}

/** Script: type `text` into the field bound to `ref` at `generation`. Same
 *  refusals as `buildTypeScript` (disabled/readonly/non-editable), and a stale
 *  ref is `{found:false}`. */
export function buildTypeByRefScript(ref: string, text: string, generation: number): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkTypeRef(${JSON.stringify(ref)}, ${Number(generation)}, ${JSON.stringify(text)}));`;
}

/** A `wait_for` condition: a ref present, a role (+optional name) present, or a
 *  substring present in the page's visible text. Exactly one is set. */
export type WaitCondition =
  | { ref: string; role?: never; name?: never; text?: never }
  | { role: string; name?: string; ref?: never; text?: never }
  | { text: string; ref?: never; role?: never; name?: never };

/** Script: a single SYNCHRONOUS check of `condition` (no observer, no blocking —
 *  the frontend polls this). Reports `{matched}` and, for a ref/role condition,
 *  the matched `ref`. A stale ref (store reset on navigation) is `matched:false`.
 *  Role and text conditions see through open shadow roots (S-05). */
export function buildWaitConditionScript(condition: WaitCondition, generation: number): string {
  // Exactly one of ref / role / text, and `name` only alongside `role`. The type
  // could not say so; an empty object used to become a search for "" (always
  // matched) and a multi-field one silently picked by priority.
  const c = condition as { ref?: unknown; role?: unknown; name?: unknown; text?: unknown };
  const set = [c.ref, c.role, c.text].filter((v) => v !== undefined).length;
  const stringOrAbsent = (v: unknown) => v === undefined || typeof v === "string";
  if (
    set !== 1 ||
    (c.name !== undefined && c.role === undefined) ||
    ![c.ref, c.role, c.name, c.text].every(stringOrAbsent)
  ) {
    throw new Error("wait condition must set exactly one of ref, role (+optional name), or text, as strings");
  }
  const gen = Number(generation);
  let expr: string;
  if (typeof c.ref === "string") {
    expr = `(function(){var el=__vmarkQueryByRef(${JSON.stringify(c.ref)},${gen});return el?{matched:true,ref:${JSON.stringify(c.ref)}}:{matched:false};})()`;
  } else if (typeof c.role === "string") {
    const nameArg = typeof c.name === "string" ? JSON.stringify(c.name) : "null";
    expr = `(function(){var m=__vmarkQuery(${JSON.stringify(c.role)},${nameArg});return m.length?{matched:true,ref:__vmarkRefFor(m[0],${gen})}:{matched:false};})()`;
  } else {
    const text = JSON.stringify(c.text ?? "");
    expr = `(function(){return {matched:__vmarkPageText().indexOf(${text})>=0};})()`;
  }
  return `${AGENT_LIB}\nreturn JSON.stringify(${expr});`;
}
