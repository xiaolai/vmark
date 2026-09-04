/**
 * Injected scroll/key act scripts (WI-P4.2, audit 2026-09-03 S-07).
 *
 * Prepend `AGENT_LIB` so these reuse `__vmarkQueryByRef` and the perception core.
 * On macOS the synthetic tier IS eval-dispatched DOM events (SPIKE-3: synthesized
 * NSEvents don't deliver; trusted input is Windows/CDP), so a site that gates on
 * `event.isTrusted` will ignore them — a documented limitation, not "fixed". `key`
 * sends only page-directed `KeyboardEvent`s to a focused element; never OS-level
 * shortcuts.
 *
 * What a synthetic key now carries and does (S-07): `key`, `code` and the legacy
 * `keyCode`/`which` for the common names (Enter 13, Escape 27, Tab 9, arrows
 * 37–40, Backspace 8, Delete 46, Space 32, letters and digits), `keypress` only
 * for character keys and Enter — as engines fire it — and, when the keydown was
 * not `defaultPrevented`, the default action a page can otherwise never receive
 * from a synthetic event: Enter on an input/select inside a form performs
 * implicit submission (`form.requestSubmit(defaultButton)`; no submit button →
 * only when at most one field blocks implicit submission; a disabled default
 * button blocks it), and Tab / Shift+Tab moves focus to the next / previous
 * tabbable element. The result says which: `defaultAction:
 * 'submitted' | 'focus-moved' | null`.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — AGENT_LIB (role/name/ref lib)
 * @module lib/browser/agent/interactScript
 */

import { AGENT_LIB } from "./actScript";

/** Scroll a ref into view or scroll the window by a delta. Refuses a stale ref. */
const SCROLL_LIB = `
function __vmarkScroll(ref,gen,dy){
  if(ref){
    var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,scrolled:false};
    if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});
    return {found:true,scrolled:true};
  }
  if(typeof window!=='undefined'&&window&&window.scrollBy)window.scrollBy(0,dy||0);
  return {scrolled:true};
}`;

/** Key names → code / legacy keyCode, and the events + default actions. */
const KEY_LIB = `
function __vmarkKeyInfo(key){
  if(key==='Space'||key==='Spacebar')key=' ';
  if(key==='Esc')key='Escape';
  var named={Enter:[13,'Enter'],Escape:[27,'Escape'],Tab:[9,'Tab'],Backspace:[8,'Backspace'],Delete:[46,'Delete'],
    ArrowLeft:[37,'ArrowLeft'],ArrowUp:[38,'ArrowUp'],ArrowRight:[39,'ArrowRight'],ArrowDown:[40,'ArrowDown'],
    Home:[36,'Home'],End:[35,'End'],PageUp:[33,'PageUp'],PageDown:[34,'PageDown'],' ':[32,'Space']};
  var n=Object.prototype.hasOwnProperty.call(named,key)?named[key]:null;
  if(n)return {key:key,code:n[1],keyCode:n[0],printable:key===' '||key==='Enter'};
  if(key.length===1){
    if(/[a-z]/i.test(key))return {key:key,code:'Key'+key.toUpperCase(),keyCode:key.toUpperCase().charCodeAt(0),printable:true};
    if(/[0-9]/.test(key))return {key:key,code:'Digit'+key,keyCode:key.charCodeAt(0),printable:true};
    return {key:key,code:'',keyCode:0,printable:true};
  }
  return {key:key,code:'',keyCode:0,printable:false};
}
function __vmarkKeyEvent(type,info,mods,charCode){
  var opts={key:info.key,code:info.code,bubbles:true,cancelable:true,keyCode:info.keyCode,which:info.keyCode,charCode:charCode||0};
  opts.ctrlKey=!!mods.ctrl;opts.shiftKey=!!mods.shift;opts.altKey=!!mods.alt;opts.metaKey=!!mods.meta;
  var ev=new KeyboardEvent(type,opts);
  // An engine that ignores the legacy init members still exposes the getters:
  // shadow them on the instance so keyCode/which switch statements see the key.
  if(ev.keyCode!==info.keyCode){try{Object.defineProperty(ev,'keyCode',{get:function(){return info.keyCode;}});}catch(e){}}
  if(ev.which!==info.keyCode){try{Object.defineProperty(ev,'which',{get:function(){return info.keyCode;}});}catch(e){}}
  return ev;
}
function __vmarkActiveElement(){
  var ae=document.activeElement,guard=0;
  while(ae&&ae.shadowRoot&&ae.shadowRoot.activeElement&&guard++<32)ae=ae.shadowRoot.activeElement;
  return ae;
}
function __vmarkDefaultButton(form){
  var els=form.elements||[];
  for(var i=0;i<els.length;i++){
    var e=els[i],tag=String(e.tagName||'').toLowerCase(),ty=(e.getAttribute('type')||'').toLowerCase();
    if(tag==='button'&&(ty===''||ty==='submit'))return e;
    if(tag==='input'&&(ty==='submit'||ty==='image'))return e;
  }
  return null;
}
function __vmarkBlockingFields(form){
  var els=form.elements||[],n=0;
  for(var i=0;i<els.length;i++){
    var e=els[i];
    if(String(e.tagName||'').toLowerCase()!=='input')continue;
    var ty=(e.getAttribute('type')||'text').toLowerCase();
    if(/^(text|search|url|tel|email|password|date|month|week|time|datetime-local|number)$/.test(ty))n++;
  }
  return n;
}
function __vmarkImplicitSubmit(t){
  var tag=String(t.tagName||'').toLowerCase();
  if(tag!=='input'&&tag!=='select')return null;
  if(tag==='input'&&/^(checkbox|radio|button|submit|reset|image|file)$/.test((t.getAttribute('type')||'text').toLowerCase()))return null;
  var form=t.form; if(!form||typeof form.requestSubmit!=='function')return null;
  var btn=__vmarkDefaultButton(form);
  if(btn){if(__vmarkDisabled(btn))return null;}
  else if(__vmarkBlockingFields(form)>1)return null;
  try{if(btn)form.requestSubmit(btn);else form.requestSubmit();}catch(e){return null;}
  return 'submitted';
}
function __vmarkTabbable(el){
  if(__vmarkHidden(el)||__vmarkDisabled(el))return false;
  var ti=el.getAttribute('tabindex');
  if(ti!=null&&ti!==''){var n=Number(ti);if(isFinite(n))return n>=0;}
  var t=String(el.tagName||'').toLowerCase();
  if(t==='a'||t==='area')return el.hasAttribute('href');
  if(t==='input')return (el.getAttribute('type')||'').toLowerCase()!=='hidden';
  if(t==='button'||t==='select'||t==='textarea'||t==='summary'||t==='iframe')return true;
  var ce=el.getAttribute&&el.getAttribute('contenteditable');
  return ce!==null&&ce!==undefined&&String(ce).toLowerCase()!=='false';
}
function __vmarkRadioGroupStop(el,all){
  // Sequential focus exposes ONE stop per same-name radio group: the checked radio,
  // else the first in the group (within the same form owner).
  var name=el.getAttribute('name');if(!name)return true;
  var first=null,checked=null;
  for(var i=0;i<all.length;i++){
    var o=all[i];
    if(String(o.tagName||'').toLowerCase()!=='input'||(o.getAttribute('type')||'').toLowerCase()!=='radio')continue;
    if(o.getAttribute('name')!==name||o.form!==el.form||__vmarkRootOf(o)!==__vmarkRootOf(el))continue;
    if(!__vmarkTabbable(o)||!__vmarkHasBox(o))continue;
    if(first===null)first=o;
    if(o.checked&&checked===null)checked=o;
  }
  return (checked||first)===el;
}
function __vmarkTabOrder(){
  var all=__vmarkAll(document),pos=[],zero=[];
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(!__vmarkTabbable(el)||!__vmarkHasBox(el))continue;
    if(String(el.tagName||'').toLowerCase()==='input'&&(el.getAttribute('type')||'').toLowerCase()==='radio'&&!__vmarkRadioGroupStop(el,all))continue;
    var ti=Number(el.getAttribute('tabindex')||0);
    if(ti>0)pos.push({el:el,ti:ti,i:pos.length});else zero.push(el);
  }
  pos.sort(function(a,b){return a.ti-b.ti||a.i-b.i;});
  var out=[];
  for(var j=0;j<pos.length;j++)out.push(pos[j].el);
  return out.concat(zero);
}
function __vmarkMoveFocus(t,back){
  var order=__vmarkTabOrder(); if(!order.length)return null;
  var idx=-1;
  for(var i=0;i<order.length;i++)if(order[i]===t){idx=i;break;}
  var next=idx<0?(back?order[order.length-1]:order[0]):order[(idx+(back?-1:1)+order.length)%order.length];
  if(next===t)return null;
  try{next.focus();}catch(e){return null;}
  return __vmarkActiveElement()===next?'focus-moved':null;
}
function __vmarkKeyDefault(t,info,mods){
  if(info.key==='Enter'&&!mods.shift&&!mods.ctrl&&!mods.alt&&!mods.meta)return __vmarkImplicitSubmit(t);
  if(info.key==='Tab'&&!mods.ctrl&&!mods.alt&&!mods.meta)return __vmarkMoveFocus(t,!!mods.shift);
  return null;
}
function __vmarkKey(ref,gen,key,mods){
  var el=ref?__vmarkQueryByRef(ref,gen):(__vmarkActiveElement()||document.body);
  if(ref&&!el)return {found:false,dispatched:false};
  var t=el||document.body;
  if(t.focus){try{t.focus();}catch(e){}}
  var focusedBefore=__vmarkActiveElement();
  mods=mods||{};
  var info=__vmarkKeyInfo(key);
  var proceed=t.dispatchEvent(__vmarkKeyEvent('keydown',info,mods,0));
  // preventDefault on keypress suppresses the default action too (it used to be ignored).
  if(proceed&&info.printable)proceed=t.dispatchEvent(__vmarkKeyEvent('keypress',info,mods,info.key.length===1?info.key.charCodeAt(0):13))&&proceed;
  var action=proceed?__vmarkKeyDefault(t,info,mods):null;
  // keyup follows FOCUS, as the real keyboard does: after Tab (or a keydown handler
  // that moved focus) it lands on the newly focused element. When focus did not move
  // it stays on the target, focusable or not.
  var focusedAfter=__vmarkActiveElement();
  var up=(focusedAfter&&focusedAfter!==focusedBefore)?focusedAfter:t;
  up.dispatchEvent(__vmarkKeyEvent('keyup',info,mods,0));
  return {found:true,dispatched:true,defaultAction:action};
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
  return `${AGENT_LIB}\n${SCROLL_LIB}\nreturn JSON.stringify(__vmarkScroll(${JSON.stringify(ref)}, ${Number(generation)}, 0));`;
}

/** Script: scroll the window vertically by `dy` pixels. Reports `{scrolled:true}`. */
export function buildScrollByScript(dy: number): string {
  return `${AGENT_LIB}\n${SCROLL_LIB}\nreturn JSON.stringify(__vmarkScroll(null, 0, ${Number(dy)}));`;
}

/** Script: dispatch a synthetic key (`key` + `mods`) — keydown, keypress for
 *  character keys, keyup, each carrying `key`/`code`/`keyCode`/`which` — to the
 *  element bound to `ref` at `generation`, or the active element when `ref` is
 *  null, then emulate the default action if the keydown was not prevented.
 *  Reports `{found, dispatched, defaultAction:'submitted'|'focus-moved'|null}`; a
 *  stale ref is `{found:false, dispatched:false}`. */
export function buildKeyScript(
  key: string,
  ref: string | null,
  generation: number,
  mods?: KeyModifiers,
): string {
  const refArg = ref ? JSON.stringify(ref) : "null";
  return `${AGENT_LIB}\n${KEY_LIB}\nreturn JSON.stringify(__vmarkKey(${refArg}, ${Number(generation)}, ${JSON.stringify(key)}, ${JSON.stringify(mods ?? {})}));`;
}
