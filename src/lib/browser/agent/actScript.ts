/**
 * Injected agent act-scripts (WI-2.3 — macOS synthetic interaction tier).
 *
 * Purpose: generate the self-contained JS the driver evaluates (via `browser_eval`,
 * WI-2.1) in the page's isolated world to *read* (snapshot) and *act* (click/type)
 * by ARIA role + accessible name. On macOS the synthetic tier IS eval-dispatched
 * DOM events (SPIKE-3 found synthesized NSEvents don't deliver; trusted input is
 * Windows/CDP). The scripts must run standalone in the page, so the role/name
 * logic is inlined here — a pragmatic mirror of `agent/aria.ts` (which is the
 * frontend-side source of truth and is unit-tested against the same rules).
 *
 * Every builder returns a script ending in `return JSON.stringify(...)`, matching
 * how `callAsyncJavaScript` awaits a result. Locating never crosses role
 * boundaries, so "click the button named Publish" can't hit a same-named link.
 *
 * @coordinates-with lib/browser/agent/aria.ts — same role/accessible-name rules
 * @coordinates-with src-tauri browser_eval — evaluates these scripts
 * @module lib/browser/agent/actScript
 */

/** Standalone role/name/query/snapshot/click/type library, injected verbatim. */
const AGENT_LIB = `
function __vmarkRole(el){
  var r=el.getAttribute('role'); if(r)return r.trim().toLowerCase();
  var t=el.tagName.toLowerCase();
  if(/^h[1-6]$/.test(t))return 'heading';
  switch(t){
    case 'button':return 'button';
    case 'a':return el.hasAttribute('href')?'link':null;
    case 'nav':return 'navigation';
    case 'textarea':return 'textbox';
    case 'select':return 'combobox';
    case 'img':return 'img';
    case 'input':
      var ty=(el.getAttribute('type')||'text').toLowerCase();
      if(ty==='checkbox')return 'checkbox';
      if(ty==='radio')return 'radio';
      if(ty==='submit'||ty==='button'||ty==='reset'||ty==='image')return 'button';
      if(ty==='range')return 'slider';
      if(ty==='hidden')return null;
      return 'textbox';
    default:return null;
  }
}
function __vmarkNorm(s){return (s||'').replace(/\\s+/g,' ').trim();}
function __vmarkName(el){
  var al=el.getAttribute('aria-label'); if(al&&al.trim())return al.trim();
  var t=el.tagName.toLowerCase();
  if(t==='img')return __vmarkNorm(el.getAttribute('alt'));
  if(t==='input'||t==='textarea'||t==='select'){
    var id=el.getAttribute('id');
    if(id){var labs=document.querySelectorAll('label[for]');
      for(var i=0;i<labs.length;i++){if(labs[i].getAttribute('for')===id&&labs[i].textContent.trim())return __vmarkNorm(labs[i].textContent);}}
    var wrap=el.closest?el.closest('label'):null;
    if(wrap&&wrap.textContent.trim())return __vmarkNorm(wrap.textContent);
    var ph=el.getAttribute('placeholder'); if(ph&&ph.trim())return ph.trim();
    return '';
  }
  if(el.textContent&&el.textContent.trim())return __vmarkNorm(el.textContent);
  return (el.getAttribute('title')||'').trim();
}
function __vmarkQuery(role,name){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){var el=all[i];
    if(__vmarkRole(el)===role&&(name==null||__vmarkName(el)===name))out.push(el);}
  return out;
}
function __vmarkSnapshot(){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){var r=__vmarkRole(all[i]); if(r)out.push({role:r,name:__vmarkName(all[i])});}
  return out;
}
function __vmarkClick(role,name){
  var m=__vmarkQuery(role,name); if(!m.length)return {found:false,clicked:false};
  m[0].click(); return {found:true,clicked:true};
}
function __vmarkType(role,name,text){
  var m=__vmarkQuery(role,name); if(!m.length)return {found:false,typed:false};
  var el=m[0]; if(el.focus)el.focus(); el.value=text;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return {found:true,typed:true};
}`;

/** Script: read the page as a flat ARIA snapshot (`[{role,name},…]`). */
export function buildSnapshotScript(): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkSnapshot());`;
}

/** Script: click the element with `role` + accessible `name` (exact). */
export function buildClickScript(role: string, name: string): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkClick(${JSON.stringify(role)}, ${JSON.stringify(name)}));`;
}

/** Script: set the value of a field by `role` + `name` and fire input/change. */
export function buildTypeScript(role: string, name: string, text: string): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkType(${JSON.stringify(role)}, ${JSON.stringify(name)}, ${JSON.stringify(text)}));`;
}
