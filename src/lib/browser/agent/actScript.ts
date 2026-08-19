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
 * @coordinates-with lib/browser/agent/aria.ts — same role/name/state/visibility rules
 * @coordinates-with lib/browser/agent/refs.ts — the mirrored per-node ref store
 * @coordinates-with src-tauri browser_eval — evaluates these scripts
 * @module lib/browser/agent/actScript
 */

import { AGENT_LIB } from "./agentLib";

// Re-exported so sibling injected-script modules (interactScript, powerScript)
// keep their import path.
export { AGENT_LIB };

/** Script: read the page as a flat ARIA snapshot (`[{role,name,ref,…},…]`).
 *  `generation` scopes the ref store, so refs reset across a navigation. */
export function buildSnapshotScript(generation = 0): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkSnapshot(${Number(generation)}));`;
}

/** Script: click the element with `role` + accessible `name` (exact). Reports
 *  `{found, clicked, reason?}` — a disabled target is never a click. */
export function buildClickScript(role: string, name: string): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkClick(${JSON.stringify(role)}, ${JSON.stringify(name)}));`;
}

/** Script: replace the value of the field with `role` + `name` and fire
 *  input/change. Reports `{found, typed, reason?}` — a disabled, readonly, or
 *  non-editable target is refused, never silently mutated. */
export function buildTypeScript(role: string, name: string, text: string): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkType(${JSON.stringify(role)}, ${JSON.stringify(name)}, ${JSON.stringify(text)}));`;
}

/** Script: click the element bound to `ref` at `generation` (exact, order-
 *  independent). Resolves nothing — reports `{found:false}` — if the ref is stale
 *  (the store reset on navigation), so an old handle can never hit a new element. */
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
export interface WaitCondition {
  ref?: string;
  role?: string;
  name?: string;
  text?: string;
}

/** Script: a single SYNCHRONOUS check of `condition` (no observer, no blocking —
 *  the frontend polls this). Reports `{matched}` and, for a ref/role condition,
 *  the matched `ref`. A stale ref (store reset on navigation) is `matched:false`. */
export function buildWaitConditionScript(condition: WaitCondition, generation: number): string {
  const gen = Number(generation);
  let expr: string;
  if (condition.ref !== undefined) {
    expr = `(function(){var el=__vmarkQueryByRef(${JSON.stringify(condition.ref)},${gen});return el?{matched:true,ref:${JSON.stringify(condition.ref)}}:{matched:false};})()`;
  } else if (condition.role !== undefined) {
    const nameArg = condition.name !== undefined ? JSON.stringify(condition.name) : "null";
    expr = `(function(){var m=__vmarkQuery(${JSON.stringify(condition.role)},${nameArg});return m.length?{matched:true,ref:__vmarkRefFor(m[0],${gen})}:{matched:false};})()`;
  } else {
    const text = JSON.stringify(condition.text ?? "");
    expr = `(function(){var b=document.body,t=(b&&(b.innerText||b.textContent))||'';return {matched:t.indexOf(${text})>=0};})()`;
  }
  return `${AGENT_LIB}\nreturn JSON.stringify(${expr});`;
}
