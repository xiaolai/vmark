/**
 * The drain stamp (audit 2026-09-03, S-01) — the one snippet both host clear
 * scripts write and both page-world shims read.
 *
 * Why it exists: each shim keeps a closure array as its source of truth and
 * rewrites the DOM element from it on every event. A host clear that only blanked
 * the element therefore lost nothing — the very next event re-published every
 * entry already drained, so a recording held each step once per drain interval
 * it survived, and a `console {clear:true}` read showed old entries again on the
 * next log. The clearing read now also bumps a counter attribute on the element;
 * a shim compares it with the value it last saw before every push and drops its
 * closure copy when the counter has moved. O(1) per event, and a page that forges
 * the counter only discards its own buffered events.
 *
 * @coordinates-with lib/browser/agent/consoleShim.ts — clearing read
 * @coordinates-with lib/browser/agent/recorderShim.ts — clearing drain
 * @coordinates-with lib/browser/agent/consoleShim.src.js, recorderShim.src.js — the readers
 * @module lib/browser/agent/shimDrain
 */

/** The attribute the shims read (`data-drain`). */
export const DRAIN_ATTR = "data-drain";

/**
 * Script fragment that advances the stamp on the element held in `elVar`. Always
 * CHANGES the value: a page-forged non-numeric or negative value restarts at 1
 * rather than sticking at NaN, which would freeze the stamp and let the
 * re-publish defect back in.
 */
export function bumpDrainStamp(elVar: string): string {
  const attr = JSON.stringify(DRAIN_ATTR);
  return (
    `var __n=Number(${elVar}.getAttribute(${attr}));` +
    `${elVar}.setAttribute(${attr},String(isFinite(__n)&&__n>=0?Math.floor(__n)+1:1));`
  );
}
