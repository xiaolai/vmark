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
  // A fresh random nonce, not a counter: the shim only asks "did the stamp move
  // since I last looked?", and a counter a page could forge (or drive past 2^53,
  // where Number arithmetic stops changing) let a clear re-publish drained entries.
  return `${elVar}.setAttribute(${attr},String(Math.random()).slice(2)+"-"+String(Date.now()));`;
}

/** Longest buffer text the reader will parse. A page owns the buffer element, so
 *  its size is page-controlled; the bound is applied to the RAW text before
 *  `JSON.parse` — the host-side parser limit came too late to stop the allocation. */
const MAX_DRAIN_CHARS = 256 * 1024;

/**
 * Isolated-world script that reads (and optionally clears) a page-world ring
 * buffer element. Returns `JSON.stringify({[key]: [...]})`, or
 * `{[key]: [], oversized: true}` when the raw text exceeds `MAX_DRAIN_CHARS`. A
 * page that cleared or corrupted the buffer just yields `[]` — the reader never
 * throws. A clearing read also bumps the drain stamp, which is what makes the
 * clear stick (audit 2026-09-03 S-01): the shim's closure array is its source of
 * truth and used to re-publish every drained entry on the next log.
 *
 * ONE builder for the console and recorder buffers — the two copies had already
 * started to drift.
 */
export function buildDrainScript(bufferId: string, key: "entries" | "events", clear: boolean): string {
  const id = JSON.stringify(bufferId);
  return (
    `var e=document.getElementById(${id});var b=[];var o=false;` +
    `if(e){var r=e.textContent||"[]";if(r.length>${MAX_DRAIN_CHARS}){o=true;}else{try{b=JSON.parse(r);}catch(x){}}}` +
    (clear ? `if(e){e.textContent="[]";${bumpDrainStamp("e")}}` : "") +
    `return JSON.stringify(o?{${key}:[],oversized:true}:{${key}:b});`
  );
}
