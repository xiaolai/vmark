/**
 * Injected scroll/key act scripts (WI-P4.2).
 *
 * Prepend `AGENT_LIB` so these reuse `__vmarkQueryByRef`. On macOS the synthetic
 * tier IS eval-dispatched DOM events (SPIKE-3: synthesized NSEvents don't deliver;
 * trusted input is Windows/CDP), so a site that gates on `event.isTrusted` will
 * ignore them — a documented limitation, not "fixed". `key` sends only
 * page-directed `KeyboardEvent`s to a focused element; never OS-level shortcuts.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — AGENT_LIB (role/name/ref lib)
 * @module lib/browser/agent/interactScript
 */

import { AGENT_LIB } from "./actScript";

/** Scroll a ref into view or scroll the window by a delta; dispatch a synthetic
 *  KeyboardEvent to a ref (or the active element). Both refuse a stale ref. */
const INTERACT_LIB = `
function __vmarkScroll(ref,gen,dy){
  if(ref){
    var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,scrolled:false};
    if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});
    return {found:true,scrolled:true};
  }
  if(typeof window!=='undefined'&&window&&window.scrollBy)window.scrollBy(0,dy||0);
  return {scrolled:true};
}
function __vmarkKey(ref,gen,key,mods){
  var el=ref?__vmarkQueryByRef(ref,gen):(document.activeElement||document.body);
  if(ref&&!el)return {found:false,dispatched:false};
  var t=el||document.body;
  if(t.focus){try{t.focus();}catch(e){}}
  var opts={key:key,bubbles:true,cancelable:true};
  if(mods){opts.ctrlKey=!!mods.ctrl;opts.shiftKey=!!mods.shift;opts.altKey=!!mods.alt;opts.metaKey=!!mods.meta;}
  t.dispatchEvent(new KeyboardEvent('keydown',opts));
  t.dispatchEvent(new KeyboardEvent('keypress',opts));
  t.dispatchEvent(new KeyboardEvent('keyup',opts));
  return {found:true,dispatched:true};
}`;

/** Keyboard modifiers for a `key` act. */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** Script: scroll the element bound to `ref` (at `generation`) into view.
 *  Reports `{found, scrolled}`; a stale ref is `{found:false}`. */
export function buildScrollToRefScript(ref: string, generation: number): string {
  return `${AGENT_LIB}\n${INTERACT_LIB}\nreturn JSON.stringify(__vmarkScroll(${JSON.stringify(ref)}, ${Number(generation)}, 0));`;
}

/** Script: scroll the window vertically by `dy` pixels. Reports `{scrolled:true}`. */
export function buildScrollByScript(dy: number): string {
  return `${AGENT_LIB}\n${INTERACT_LIB}\nreturn JSON.stringify(__vmarkScroll(null, 0, ${Number(dy)}));`;
}

/** Script: dispatch a synthetic `KeyboardEvent` (`key` + `mods`) to the element
 *  bound to `ref` at `generation`, or the active element when `ref` is null.
 *  Reports `{found, dispatched}`; a stale ref is `{found:false}`. */
export function buildKeyScript(
  key: string,
  ref: string | null,
  generation: number,
  mods?: KeyModifiers,
): string {
  const refArg = ref ? JSON.stringify(ref) : "null";
  return `${AGENT_LIB}\n${INTERACT_LIB}\nreturn JSON.stringify(__vmarkKey(${refArg}, ${Number(generation)}, ${JSON.stringify(key)}, ${JSON.stringify(mods ?? {})}));`;
}
