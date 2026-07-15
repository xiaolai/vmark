/**
 * Injected agent act-scripts (WI-2.3 — macOS synthetic interaction tier).
 *
 * Purpose: generate the self-contained JS the driver evaluates (via `browser_eval`,
 * WI-2.1) in the page's isolated world to *read* (snapshot) and *act* (click/type)
 * by ARIA role + accessible name. On macOS the synthetic tier IS eval-dispatched
 * DOM events (SPIKE-3 found synthesized NSEvents don't deliver; trusted input is
 * Windows/CDP). The scripts must run standalone in the page — no bundler, no
 * imports — so the role/name logic is inlined here as a copy of `agent/aria.ts`.
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
 * @coordinates-with lib/browser/agent/aria.ts — same role/name/state/visibility rules
 * @coordinates-with src-tauri browser_eval — evaluates these scripts
 * @module lib/browser/agent/actScript
 */

/** Role inference — mirrors `computeRole`. */
const LIB_ROLE = `
var __vmarkInputRoles={checkbox:'checkbox',radio:'radio',submit:'button',button:'button',
  reset:'button',image:'button',range:'slider',number:'spinbutton',search:'searchbox',hidden:null};
function __vmarkRole(el){
  var r=el.getAttribute('role');
  if(r&&r.trim()){
    var first=r.trim().toLowerCase().split(/\\s+/)[0];
    return (first==='presentation'||first==='none')?null:first;
  }
  var t=el.tagName.toLowerCase();
  if(/^h[1-6]$/.test(t))return 'heading';
  switch(t){
    case 'button':return 'button';
    case 'a':return el.hasAttribute('href')?'link':null;
    case 'nav':return 'navigation';
    case 'main':return 'main';
    case 'textarea':return 'textbox';
    case 'select':
      return (el.hasAttribute('multiple')||Number(el.getAttribute('size')||'1')>1)?'listbox':'combobox';
    case 'img':return 'img';
    case 'input':
      var ty=(el.getAttribute('type')||'text').toLowerCase();
      return (ty in __vmarkInputRoles)?__vmarkInputRoles[ty]:'textbox';
    default:return null;
  }
}`;

/** Accessible name — mirrors `accessibleName` (aria-label, aria-labelledby, labels,
 *  image-input alt, placeholder, button value, text, title — all normalized). */
const LIB_NAME = `
function __vmarkNorm(s){return (s||'').replace(/\\s+/g,' ').trim();}
function __vmarkIdListText(el,ids){
  var doc=el.ownerDocument,out=[];
  ids.trim().split(/\\s+/).forEach(function(id){
    var ref=doc?doc.getElementById(id):null;
    out.push(ref?(ref.textContent||''):'');
  });
  return __vmarkNorm(out.join(' '));
}
function __vmarkLabelText(el){
  var labels=el.labels;
  if(labels&&labels.length){
    var parts=[];
    for(var i=0;i<labels.length;i++)parts.push(labels[i].textContent||'');
    return __vmarkNorm(parts.join(' '));
  }
  var wrap=el.closest?el.closest('label'):null;
  return wrap?__vmarkNorm(wrap.textContent):'';
}
function __vmarkControlName(el){
  var label=__vmarkLabelText(el); if(label)return label;
  var ty=(el.getAttribute('type')||'').toLowerCase();
  if(ty==='image'){var alt=__vmarkNorm(el.getAttribute('alt')); if(alt)return alt;}
  var ph=el.getAttribute('placeholder'); if(ph&&ph.trim())return __vmarkNorm(ph);
  if(ty==='submit'||ty==='button'||ty==='reset'||ty==='image'){
    var v=el.getAttribute('value'); if(v&&v.trim())return __vmarkNorm(v);
  }
  return '';
}
function __vmarkName(el){
  var lb=el.getAttribute('aria-labelledby');
  if(lb){var t=__vmarkIdListText(el,lb); if(t)return t;}
  var al=el.getAttribute('aria-label'); if(al&&al.trim())return __vmarkNorm(al);
  var tag=el.tagName.toLowerCase();
  if(tag==='img')return __vmarkNorm(el.getAttribute('alt'));
  if(tag==='input'||tag==='textarea'||tag==='select')return __vmarkControlName(el);
  if(el.textContent&&el.textContent.trim())return __vmarkNorm(el.textContent);
  return __vmarkNorm(el.getAttribute('title'));
}`;

/** Stable per-document element refs — mirrors `refs.ts` (`refFor`/`queryByRef`).
 *  The store lives on `document`, so refs persist across reads within a page and
 *  reset when a navigation replaces the document. Same shape + assignment order as
 *  `refs.ts`, so `actScript.test.ts`'s parity check holds. */
const LIB_REFS = `
function __vmarkRefStore(){
  var d=document;
  if(!d.__vmarkRefStore){d.__vmarkRefStore={refs:new WeakMap(),byRef:new Map(),n:0};}
  return d.__vmarkRefStore;
}
function __vmarkRefFor(el){
  var s=__vmarkRefStore(),ex=s.refs.get(el);
  if(ex)return ex;
  var ref='e'+(++s.n);
  s.refs.set(el,ref);s.byRef.set(ref,el);
  return ref;
}
function __vmarkQueryByRef(ref){
  var s=__vmarkRefStore(),el=s.byRef.get(ref);
  if(!el||!el.isConnected)return null;
  return el;
}`;

/** Visibility, state, locating, snapshot — mirrors `isHidden`/`isDisabled`/
 *  `isChecked`/`queryByRole`/`ariaSnapshot`. */
const LIB_QUERY = `
function __vmarkHidden(el){
  for(var n=el;n;n=n.parentElement){
    if(n.hasAttribute('hidden')||n.hasAttribute('inert'))return true;
    if(n.getAttribute('aria-hidden')==='true')return true;
    var s=n.style;
    if(s&&(s.display==='none'||s.visibility==='hidden'))return true;
  }
  return false;
}
function __vmarkDisabled(el){
  if(el.getAttribute('aria-disabled')==='true')return true;
  if(el.matches&&el.matches(':disabled'))return true;
  return el.hasAttribute('disabled');
}
function __vmarkChecked(el){
  if(el.tagName==='INPUT')return !!el.checked;
  return el.getAttribute('aria-checked')==='true';
}
function __vmarkQuery(role,name){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(__vmarkRole(el)!==role)continue;
    if(__vmarkHidden(el))continue;
    if(name!=null&&__vmarkName(el)!==name)continue;
    out.push(el);
  }
  return out;
}
var __vmarkLevels={H1:1,H2:2,H3:3,H4:4,H5:5,H6:6};
function __vmarkSnapshot(){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){
    var el=all[i],role=__vmarkRole(el);
    if(!role||__vmarkHidden(el))continue;
    var node={role:role,name:__vmarkName(el),ref:__vmarkRefFor(el)};
    if(role==='heading')node.level=__vmarkLevels[el.tagName]||(Number(el.getAttribute('aria-level'))||undefined);
    if(role==='checkbox'||role==='radio')node.checked=__vmarkChecked(el);
    if(__vmarkDisabled(el))node.disabled=true;
    out.push(node);
  }
  return out;
}`;

/** Acting — click/type. Both refuse what they cannot actually do and say why. */
const LIB_ACT = `
function __vmarkClick(role,name){
  var m=__vmarkQuery(role,name); if(!m.length)return {found:false,clicked:false};
  var el=m[0];
  if(__vmarkDisabled(el))return {found:true,clicked:false,reason:'disabled'};
  el.click();
  return {found:true,clicked:true};
}
function __vmarkSetValue(el,text){
  // A framework (React) installs its own \`value\` setter on the NODE to track
  // changes; assigning through it updates the tracker first, so the framework then
  // sees "no change" and drops the keystroke. Going through the prototype's native
  // setter leaves the tracker stale, which is exactly what makes the change visible.
  var desc=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');
  if(desc&&desc.set){desc.set.call(el,text);return;}
  el.value=text;
}
function __vmarkType(role,name,text){
  var m=__vmarkQuery(role,name); if(!m.length)return {found:false,typed:false};
  var el=m[0],tag=el.tagName.toLowerCase();
  if(__vmarkDisabled(el))return {found:true,typed:false,reason:'disabled'};
  if(tag!=='input'&&tag!=='textarea')return {found:true,typed:false,reason:'not-editable'};
  if(el.readOnly)return {found:true,typed:false,reason:'readonly'};
  try{
    if(el.focus)el.focus();
    __vmarkSetValue(el,text);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(e){
    return {found:true,typed:false,reason:String((e&&e.message)||e)};
  }
  return {found:true,typed:true};
}`;

/** Standalone role/name/refs/query/snapshot/click/type library, injected verbatim. */
const AGENT_LIB = [LIB_ROLE, LIB_NAME, LIB_REFS, LIB_QUERY, LIB_ACT].join("\n");

/** Script: read the page as a flat ARIA snapshot (`[{role,name,…},…]`). */
export function buildSnapshotScript(): string {
  return `${AGENT_LIB}\nreturn JSON.stringify(__vmarkSnapshot());`;
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
