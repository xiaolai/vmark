/**
 * The injected agent library (WI-2.3 / WI-NB1.1) — the standalone ES5 role /
 * name / refs / query / visibility / act functions prepended to every driver
 * script. Split from `actScript.ts` (which keeps the script BUILDERS) purely
 * along that seam; the behaviour contract and the parity story are unchanged
 * and live in actScript's header.
 *
 * Everything here must run standalone in the page's isolated world — no
 * imports, no bundler. `actScript.test.ts` and `actScript.webkit.test.ts`
 * execute these exact bytes through the builders; `agentLib.test.ts` pins the
 * assembly.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — the builders
 * @coordinates-with lib/browser/agent/aria.ts — the TS twin of the perception rules
 * @module lib/browser/agent/agentLib
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
function __vmarkRefStore(gen){
  var d=document;
  if(!d.__vmarkRefStore||d.__vmarkRefStore.gen!==gen){
    d.__vmarkRefStore={refs:new WeakMap(),byRef:new Map(),n:0,gen:gen};
  }
  return d.__vmarkRefStore;
}
function __vmarkRefFor(el,gen){
  var s=__vmarkRefStore(gen),ex=s.refs.get(el);
  if(ex)return ex;
  var ref='e'+(++s.n);
  s.refs.set(el,ref);s.byRef.set(ref,new WeakRef(el));
  return ref;
}
function __vmarkQueryByRef(ref,gen){
  var s=__vmarkRefStore(gen),w=s.byRef.get(ref),el=w?w.deref():null;
  if(!el||!el.isConnected||el.ownerDocument!==document)return null;
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
function __vmarkQueryAll(role,name){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(__vmarkRole(el)!==role)continue;
    if(name!=null&&__vmarkName(el)!==name)continue;
    out.push(el);
  }
  return out;
}
function __vmarkHasLayout(){
  var d=document.documentElement;
  if(!d||!d.getBoundingClientRect)return false;
  var r=d.getBoundingClientRect();
  return r.width>0||r.height>0;
}
function __vmarkRendered(el){
  if(!__vmarkHasLayout())return true;
  var r=el.getBoundingClientRect();
  if(r.width===0||r.height===0)return false;
  var cs=getComputedStyle(el);
  if(cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0')return false;
  for(var p=el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
    var pr=p.getBoundingClientRect();
    if(pr.height===0&&getComputedStyle(p).overflow!=='visible')return false;
  }
  return true;
}
function __vmarkActable(el){return !__vmarkHidden(el)&&__vmarkRendered(el);}
function __vmarkDescribe(el){
  var t=el.tagName.toLowerCase();
  var c=(typeof el.className==='string')?el.className.trim().split(/\\s+/).slice(0,2).join('.'):'';
  return c?t+'.'+c:t;
}
function __vmarkObscuredBy(el){
  if(!__vmarkHasLayout()||!document.elementFromPoint)return null;
  var r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  var hit=document.elementFromPoint(cx,cy);
  if(!hit||hit===el||el.contains(hit)||hit.contains(el))return null;
  return __vmarkDescribe(hit);
}
var __vmarkLevels={H1:1,H2:2,H3:3,H4:4,H5:5,H6:6};
function __vmarkSnapshot(gen){
  var all=document.querySelectorAll('*'),out=[];
  for(var i=0;i<all.length;i++){
    var el=all[i],role=__vmarkRole(el);
    if(!role||__vmarkHidden(el))continue;
    var node={role:role,name:__vmarkName(el),ref:__vmarkRefFor(el,gen)};
    if(role==='heading')node.level=__vmarkLevels[el.tagName]||(Number(el.getAttribute('aria-level'))||undefined);
    if(role==='checkbox'||role==='radio')node.checked=__vmarkChecked(el);
    if(__vmarkDisabled(el))node.disabled=true;
    out.push(node);
  }
  return out;
}`;

/** Acting — click/type. Both refuse what they cannot actually do and say why
 *  (WI-NB1.1): a click scrolls its target into view, refuses hidden and occluded
 *  targets, and role/name results carry matchedTotal/matchedVisible so ambiguity
 *  is visible to the model (the accordion-form failure class: N same-name
 *  matches, only the rendered one may be acted on). Layout checks self-disable
 *  where no layout engine exists (jsdom), leaving the attribute tier. */
const LIB_ACT = `
function __vmarkAssign(base,extra){
  if(extra)for(var k in extra)if(Object.prototype.hasOwnProperty.call(extra,k))base[k]=extra[k];
  return base;
}
function __vmarkDoClick(el,extra){
  if(__vmarkDisabled(el))return __vmarkAssign({found:true,clicked:false,reason:'disabled'},extra);
  if(el.scrollIntoView&&__vmarkHasLayout())el.scrollIntoView({block:'center',inline:'center'});
  var by=__vmarkObscuredBy(el);
  if(by)return __vmarkAssign({found:true,clicked:false,reason:'obscured',by:by},extra);
  el.click();
  return __vmarkAssign({found:true,clicked:true},extra);
}
function __vmarkClick(role,name){
  var all=__vmarkQueryAll(role,name);
  if(!all.length)return {found:false,clicked:false,matchedTotal:0,matchedVisible:0};
  var vis=[];
  for(var i=0;i<all.length;i++)if(__vmarkActable(all[i]))vis.push(all[i]);
  var counts={matchedTotal:all.length,matchedVisible:vis.length};
  if(!vis.length)return __vmarkAssign({found:true,clicked:false,reason:'hidden'},counts);
  return __vmarkDoClick(vis[0],counts);
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
function __vmarkFireEdit(el){
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
}
function __vmarkDoType(el,text,extra){
  var tag=el.tagName.toLowerCase();
  if(__vmarkDisabled(el))return __vmarkAssign({found:true,typed:false,reason:'disabled'},extra);
  try{
    if(tag==='select'){
      var opts=el.options||[],pick=null;
      for(var i=0;i<opts.length;i++){
        if(__vmarkNorm(opts[i].textContent)===text||opts[i].value===text){pick=opts[i];break;}
      }
      if(!pick)return __vmarkAssign({found:true,typed:false,reason:'no-such-option'},extra);
      if(el.focus)el.focus();
      __vmarkSetValue(el,pick.value);
      __vmarkFireEdit(el);
      return __vmarkAssign({found:true,typed:true},extra);
    }
    if(tag==='input'||tag==='textarea'){
      if(el.readOnly)return __vmarkAssign({found:true,typed:false,reason:'readonly'},extra);
      if(el.focus)el.focus();
      __vmarkSetValue(el,text);
      __vmarkFireEdit(el);
      return __vmarkAssign({found:true,typed:true},extra);
    }
    if(el.isContentEditable){
      if(el.focus)el.focus();
      el.textContent=text;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      return __vmarkAssign({found:true,typed:true},extra);
    }
    return __vmarkAssign({found:true,typed:false,reason:'not-editable'},extra);
  }catch(e){
    return __vmarkAssign({found:true,typed:false,reason:String((e&&e.message)||e)},extra);
  }
}
function __vmarkType(role,name,text){
  var all=__vmarkQueryAll(role,name);
  if(!all.length)return {found:false,typed:false,matchedTotal:0,matchedVisible:0};
  var vis=[];
  for(var i=0;i<all.length;i++)if(__vmarkActable(all[i]))vis.push(all[i]);
  var counts={matchedTotal:all.length,matchedVisible:vis.length};
  if(!vis.length)return __vmarkAssign({found:true,typed:false,reason:'hidden'},counts);
  return __vmarkDoType(vis[0],text,counts);
}
function __vmarkClickRef(ref,gen){
  var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,clicked:false};
  if(!__vmarkActable(el))return {found:true,clicked:false,reason:'hidden'};
  return __vmarkDoClick(el,null);
}
function __vmarkTypeRef(ref,gen,text){
  var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,typed:false};
  if(!__vmarkActable(el))return {found:true,typed:false,reason:'hidden'};
  return __vmarkDoType(el,text,null);
}`;

/** Standalone role/name/refs/query/snapshot/click/type library, injected verbatim.
 *  Exported so sibling injected-script modules (`interactScript.ts`) can prepend
 *  it and reuse `__vmarkQueryByRef` / `__vmarkQuery` / `__vmarkRefFor`. */
export const AGENT_LIB = [LIB_ROLE, LIB_NAME, LIB_REFS, LIB_QUERY, LIB_ACT].join("\n");
