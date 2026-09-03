/**
 * The injected ACT library — click and type (WI-2.3 / WI-NB1.1, audit
 * 2026-09-03 S-03 / S-04 / S-08 / S-10). Split from `agentLib.ts` along the
 * perceive/act seam; `agentLib.ts` appends this string after the core, refs and
 * query sections, so everything here may call `__vmark*` from those.
 *
 * Every act refuses what it cannot truthfully do and says why:
 *   - `disabled` (+ `detail:'inert'` for an inert subtree or `pointer-events:none`
 *     target — a real pointer could not reach it, S-04), `hidden`, `upload` (a file
 *     input, or a click that would reach one through a <label>, S-10 — uploads are
 *     never permitted), `offscreen` / `obscured` (from `__vmarkOcclusion`),
 *   - `ambiguous` (S-03): a role/name that resolves to MORE THAN ONE interactable
 *     element is never resolved by DOM order after the user approved "the button
 *     named Go" — the result carries `candidates:[{ref,text}]`, refs minted in the
 *     live store so a ref act under a standing grant can pick one,
 *   - `rejected-value` (S-08): the engine sanitised the text away (letters into a
 *     number field, a newline into a single-line input) — the prior value is
 *     restored and no event fires, so a failed type has no effect,
 *   - `no-such-option`, `readonly`, `not-editable` as before.
 * Contenteditable typing dispatches a cancelable `beforeinput` first: an editor
 * that cancels it owns the insertion (`typed:true, detail:'editor-handled'`, no
 * DOM mutation under a controlled model); otherwise `execCommand('insertText')`
 * over the selected content, falling back to a mutation plus an InputEvent.
 *
 * Standalone ES5 inside a template string — regex escapes are doubled.
 *
 * @coordinates-with lib/browser/agent/agentLib.ts — assembles this after core/refs/query
 * @coordinates-with lib/browser/agent/actScript.ts — the builders that call these
 * @module lib/browser/agent/agentAct
 */

/** Refusals shared by click and type, then the click path. */
const ACT_CLICK = `
function __vmarkAssign(base,extra){
  if(extra)for(var k in extra)if(Object.prototype.hasOwnProperty.call(extra,k))base[k]=extra[k];
  return base;
}
function __vmarkReachesUpload(el){
  if(__vmarkIsFileInput(el))return true;
  var lab=el.closest?el.closest('label'):null;
  if(!lab)return false;
  if(el!==lab){
    var t=String(el.tagName||'').toLowerCase();
    if(t==='button'||t==='select'||t==='textarea'||t==='input'||t==='label'||(t==='a'&&el.hasAttribute('href')))return false;
  }
  var ctrl;
  try{ctrl=lab.control;}catch(e){ctrl=undefined;}
  if(ctrl===undefined){
    var f=lab.getAttribute('for');
    ctrl=f?__vmarkRootOf(lab).getElementById(f):lab.querySelector('input,button,select,textarea');
  }
  return !!(ctrl&&__vmarkIsFileInput(ctrl));
}
function __vmarkPick(all){
  var vis=[],inert=0;
  for(var i=0;i<all.length;i++){
    var na=__vmarkNotActable(all[i]);
    if(na===null)vis.push(all[i]);else if(na==='inert')inert++;
  }
  return {vis:vis,inert:inert};
}
function __vmarkNoneActable(verb,p,counts){
  var r={found:true};r[verb]=false;
  if(p.inert){r.reason='disabled';r.detail='inert';}else r.reason='hidden';
  return __vmarkAssign(r,counts);
}
function __vmarkAmbiguous(verb,vis,gen,counts){
  var r={found:true};r[verb]=false;r.reason='ambiguous';r.candidates=__vmarkCandidates(vis,gen);
  return __vmarkAssign(r,counts);
}
function __vmarkDoClick(el,extra){
  if(__vmarkDisabled(el))return __vmarkAssign({found:true,clicked:false,reason:'disabled'},extra);
  if(__vmarkNotActable(el)==='inert')return __vmarkAssign({found:true,clicked:false,reason:'disabled',detail:'inert'},extra);
  if(__vmarkReachesUpload(el))return __vmarkAssign({found:true,clicked:false,reason:'upload'},extra);
  if(el.scrollIntoView&&__vmarkHasLayout())el.scrollIntoView({block:'center',inline:'center'});
  var occ=__vmarkOcclusion(el);
  if(occ)return __vmarkAssign(__vmarkAssign({found:true,clicked:false},occ),extra);
  el.click();
  return __vmarkAssign({found:true,clicked:true},extra);
}
function __vmarkClick(role,name,gen){
  var all=__vmarkQueryAll(role,name);
  if(!all.length)return {found:false,clicked:false,matchedTotal:0,matchedVisible:0};
  var p=__vmarkPick(all),counts={matchedTotal:all.length,matchedVisible:p.vis.length};
  if(!p.vis.length)return __vmarkNoneActable('clicked',p,counts);
  if(p.vis.length>1)return __vmarkAmbiguous('clicked',p.vis,gen,counts);
  return __vmarkDoClick(p.vis[0],counts);
}
function __vmarkClickRef(ref,gen){
  var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,clicked:false};
  if(__vmarkNotActable(el)==='hidden')return {found:true,clicked:false,reason:'hidden'};
  return __vmarkDoClick(el,null);
}`;

/** The type path: value-bearing controls, selects, contenteditable. */
const ACT_TYPE = `
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
function __vmarkNewlines(s){return String(s).replace(/\\r\\n?/g,'\\n');}
function __vmarkTypeEditable(el,text,extra){
  if(el.focus){try{el.focus();}catch(e){}}
  var accepted=true;
  try{
    if(typeof InputEvent==='function'){
      accepted=el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:text}));
    }
  }catch(e){accepted=true;}
  if(!accepted)return __vmarkAssign({found:true,typed:true,detail:'editor-handled'},extra);
  var ok=false;
  try{
    if(typeof document.execCommand==='function'&&document.getSelection&&document.createRange){
      var sel=document.getSelection(),rng=document.createRange();
      rng.selectNodeContents(el);sel.removeAllRanges();sel.addRange(rng);
      ok=document.execCommand('insertText',false,text)===true;
    }
  }catch(e){ok=false;}
  var got=(typeof el.innerText==='string')?el.innerText:String(el.textContent||'');
  if(!ok||__vmarkNewlines(got)!==__vmarkNewlines(text)){
    el.textContent=text;
    var ie;
    try{ie=new InputEvent('input',{bubbles:true,inputType:'insertText',data:text});}catch(e){ie=new Event('input',{bubbles:true});}
    el.dispatchEvent(ie);
  }
  return __vmarkAssign({found:true,typed:true},extra);
}
function __vmarkDoType(el,text,extra){
  var tag=String(el.tagName||'').toLowerCase();
  if(__vmarkDisabled(el))return __vmarkAssign({found:true,typed:false,reason:'disabled'},extra);
  if(__vmarkNotActable(el)==='inert')return __vmarkAssign({found:true,typed:false,reason:'disabled',detail:'inert'},extra);
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
      if(__vmarkIsFileInput(el))return __vmarkAssign({found:true,typed:false,reason:'upload'},extra);
      var ty=(el.getAttribute('type')||'text').toLowerCase();
      if(tag==='input'&&/^(checkbox|radio|submit|button|reset|image)$/.test(ty))return __vmarkAssign({found:true,typed:false,reason:'not-editable'},extra);
      if(el.readOnly)return __vmarkAssign({found:true,typed:false,reason:'readonly'},extra);
      if(el.focus){try{el.focus();}catch(e){}}
      var before=el.value;
      __vmarkSetValue(el,text);
      var want=(tag==='textarea')?__vmarkNewlines(text):text;
      if(el.value!==want){__vmarkSetValue(el,before);return __vmarkAssign({found:true,typed:false,reason:'rejected-value'},extra);}
      __vmarkFireEdit(el);
      return __vmarkAssign({found:true,typed:true},extra);
    }
    if(el.isContentEditable)return __vmarkTypeEditable(el,text,extra);
    return __vmarkAssign({found:true,typed:false,reason:'not-editable'},extra);
  }catch(e){
    return __vmarkAssign({found:true,typed:false,reason:String((e&&e.message)||e)},extra);
  }
}
function __vmarkType(role,name,text,gen){
  var all=__vmarkQueryAll(role,name);
  if(!all.length)return {found:false,typed:false,matchedTotal:0,matchedVisible:0};
  var p=__vmarkPick(all),counts={matchedTotal:all.length,matchedVisible:p.vis.length};
  if(!p.vis.length)return __vmarkNoneActable('typed',p,counts);
  if(p.vis.length>1)return __vmarkAmbiguous('typed',p.vis,gen,counts);
  return __vmarkDoType(p.vis[0],text,counts);
}
function __vmarkTypeRef(ref,gen,text){
  var el=__vmarkQueryByRef(ref,gen); if(!el)return {found:false,typed:false};
  if(__vmarkNotActable(el)==='hidden')return {found:true,typed:false,reason:'hidden'};
  return __vmarkDoType(el,text,null);
}`;

/** The act section of the agent library — appended by `agentLib.ts`. */
export const AGENT_ACT = [ACT_CLICK, ACT_TYPE].join("\n");
