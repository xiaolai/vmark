/**
 * Injected DOM-detection (`query`) and CSS-manipulation (`style`) scripts
 * (WI-P5.1 / WI-P5.2). Prepend `AGENT_LIB` to reuse `__vmarkRefFor` /
 * `__vmarkQueryByRef` / `__vmarkNorm`.
 *
 * Both run in the driver's ISOLATED content world — they share the DOM (so
 * `querySelector`, `element.style`, an injected `<style>` all work) but cannot
 * see the page's own JS heap/globals. `query` is read-class; `style` is act-class
 * (op `style`). Neither is the raw `eval` hatch — `execute_js` is separate.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — AGENT_LIB
 * @module lib/browser/agent/powerScript
 */

import { AGENT_LIB } from "./actScript";

const QUERY_LIB = `
function __vmarkQueryDom(sel,gen,opts){
  var els; try{els=document.querySelectorAll(sel);}catch(e){return {error:'invalid-selector'};}
  var cap=50,n=Math.min(els.length,cap),out=[];
  for(var i=0;i<n;i++){
    var el=els[i],o={ref:__vmarkRefFor(el,gen),tag:el.tagName.toLowerCase(),text:__vmarkNorm(el.textContent).slice(0,500)};
    if(opts&&opts.attributes){o.attributes={};for(var a=0;a<el.attributes.length;a++){o.attributes[el.attributes[a].name]=el.attributes[a].value;}}
    if(opts&&opts.box&&el.getBoundingClientRect){var r=el.getBoundingClientRect();o.box={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}
    if(opts&&opts.styles&&opts.styles.length&&typeof getComputedStyle==='function'){var cs=getComputedStyle(el);o.styles={};for(var s=0;s<opts.styles.length;s++){o.styles[opts.styles[s]]=cs.getPropertyValue(opts.styles[s]);}}
    out.push(o);
  }
  return {count:els.length,truncated:els.length>n,elements:out};
}`;

const STYLE_LIB = `
function __vmarkStyleOp(sel,ref,gen,set,add,remove,injectCss){
  if(injectCss){var st=document.createElement('style');st.textContent=injectCss;(document.head||document.documentElement).appendChild(st);return {injected:true,styled:true};}
  var els;
  if(ref){var el=__vmarkQueryByRef(ref,gen);if(!el)return {found:false,styled:false};els=[el];}
  else{try{els=document.querySelectorAll(sel);}catch(e){return {error:'invalid-selector',styled:false};}}
  var n=0;
  for(var i=0;i<els.length;i++){var el=els[i];
    if(set&&el.style){for(var k in set){el.style.setProperty(k,set[k]);}}
    if(add&&el.classList){for(var j=0;j<add.length;j++)el.classList.add(add[j]);}
    if(remove&&el.classList){for(var r2=0;r2<remove.length;r2++)el.classList.remove(remove[r2]);}
    n++;
  }
  return {found:els.length>0,styled:n>0,count:n};
}`;

/** What structured fields a `query` should return beyond `{ref, tag, text}`. */
export interface QueryFields {
  attributes?: boolean;
  box?: boolean;
  styles?: string[];
}

/** Script: return structured data for elements matching `selector` (capped at
 *  50). Each carries `{ref, tag, text}` plus the requested `fields`. A bad
 *  selector reports `{error:'invalid-selector'}` rather than throwing. */
export function buildQueryScript(selector: string, generation: number, fields?: QueryFields): string {
  return `${AGENT_LIB}\n${QUERY_LIB}\nreturn JSON.stringify(__vmarkQueryDom(${JSON.stringify(selector)}, ${Number(generation)}, ${JSON.stringify(fields ?? {})}));`;
}

/** A `style` op: set inline styles, add/remove classes, or inject a `<style>` block.
 *  Applied to a `{ref}` or every element matching `{selector}`.
 *
 *  `injectCss` is NOT selector-scoped — it appends the caller's CSS to the document
 *  head verbatim, so it can restyle the whole page (and CSS can reach the network via
 *  `url()`/`@import`). This is act-class and the exact CSS is bound into the one-shot
 *  the user approves, so it cannot be swapped for other CSS after approval — but the
 *  user is approving page-wide CSS, not a scoped rule. (Security review P5, Medium #4.) */
export interface StyleOps {
  set?: Record<string, string>;
  addClasses?: string[];
  removeClasses?: string[];
  injectCss?: string;
}

/** Script: apply `ops` to the target (`ref` or `selector`) in the isolated world.
 *  Reports `{found, styled}` (or `{injected}` for injectCss — which appends a
 *  page-wide `<style>`, not a scoped rule); a stale ref is `{found:false}`. */
export function buildStyleScript(
  target: { ref?: string; selector?: string },
  generation: number,
  ops: StyleOps,
): string {
  const ref = target.ref ? JSON.stringify(target.ref) : "null";
  const sel = target.selector ? JSON.stringify(target.selector) : "null";
  return (
    `${AGENT_LIB}\n${STYLE_LIB}\nreturn JSON.stringify(__vmarkStyleOp(` +
    `${sel}, ${ref}, ${Number(generation)}, ` +
    `${JSON.stringify(ops.set ?? null)}, ${JSON.stringify(ops.addClasses ?? null)}, ` +
    `${JSON.stringify(ops.removeClasses ?? null)}, ${JSON.stringify(ops.injectCss ?? null)}));`
  );
}
