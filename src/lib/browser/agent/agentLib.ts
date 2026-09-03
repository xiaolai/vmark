/**
 * The injected agent library (WI-2.3 / WI-NB1.1) — the standalone ES5 refs /
 * query / visibility / snapshot functions prepended to every driver script,
 * assembled on the shared perception core. Split from `actScript.ts` (which keeps
 * the script BUILDERS) along that seam; the act half lives in `agentAct.ts`.
 *
 * Assembly order (audit 2026-09-03 S-02): `agentCore.src.js` (role, name,
 * hidden-ness, composed walk — the same bytes the recorder shim runs), then the
 * refs, query and act sections below. `agentLib.test.ts` pins that the library
 * starts with the core and defines each function exactly once.
 *
 * Everything here must run standalone in the page's isolated world — no imports,
 * no bundler. `actScript.test.ts`, `agentAct.test.ts` and `agentSnapshot.test.ts`
 * execute these exact bytes through the builders in jsdom;
 * `actScript.webkit.test.ts` exercises the rendered tier in real WebKit.
 *
 * @coordinates-with lib/browser/agent/agentCore.src.js — the perception core
 * @coordinates-with lib/browser/agent/agentAct.ts — the act section
 * @coordinates-with lib/browser/agent/actScript.ts — the builders
 * @coordinates-with lib/browser/agent/aria.ts — the TS mirror of the perception rules
 * @module lib/browser/agent/agentLib
 */

import { AGENT_CORE_SRC } from "./agentCore";
import { AGENT_ACT } from "./agentAct";

/** Stable per-document element refs — mirrors `refs.ts` (`refFor`/`queryByRef`).
 *  The store lives on `document`, so refs persist across reads within a page and
 *  reset when a navigation replaces the document. Same shape + assignment order as
 *  `refs.ts`, so `actScript.test.ts`'s parity check holds. `__vmarkRefForLive` mints
 *  against the store's CURRENT generation when a builder passes none, so a
 *  candidate ref (S-03) never resets a store a prior read populated. */
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
function __vmarkRefForLive(el,gen){
  if(gen==null){var s=document.__vmarkRefStore;gen=s?s.gen:0;}
  return __vmarkRefFor(el,gen);
}
function __vmarkQueryByRef(ref,gen){
  var s=__vmarkRefStore(gen),w=s.byRef.get(ref),el=w?w.deref():null;
  if(!el||!el.isConnected||el.ownerDocument!==document)return null;
  return el;
}`;

/** Locating and rendered visibility. `__vmarkRendered` needs a layout engine and
 *  self-disables without one (jsdom), leaving the attribute tier. Its walks use
 *  the composed parent, so a shadow tree inherits its host's fate. */
const LIB_QUERY = `
function __vmarkQuery(role,name){
  var all=__vmarkAll(document),out=[];
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
  var all=__vmarkAll(document),out=[];
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
function __vmarkHasBox(el){
  if(!__vmarkHasLayout())return true;
  var r=el.getBoundingClientRect();
  return r.width>0&&r.height>0;
}
function __vmarkRendered(el){
  if(!__vmarkHasLayout())return true;
  var r=el.getBoundingClientRect();
  if(r.width===0||r.height===0)return false;
  // Entirely in negative page coordinates: no scroll can ever reach it (the
  // left:-9999px idiom), so it is not something a user could see or click.
  var sx=(typeof window!=='undefined'&&window.pageXOffset)||0,sy=(typeof window!=='undefined'&&window.pageYOffset)||0;
  if(r.right+sx<=0||r.bottom+sy<=0)return false;
  var cs=getComputedStyle(el);
  // visibility is INHERITED, so the element's own computed value already reflects
  // every ancestor — and a descendant may legitimately override to visible.
  if(cs.visibility==='hidden'||cs.visibility==='collapse')return false;
  // opacity and display are not: an ancestor's opacity:0 hides everything below it
  // and nothing below can undo it, so those walk the whole composed ancestry.
  for(var p=el;p;p=__vmarkParent(p)){
    var ps=(p===el)?cs:getComputedStyle(p);
    if(ps.display==='none'||ps.opacity==='0')return false;
  }
  for(var q=__vmarkParent(el);q&&q!==document.body&&q!==document.documentElement;q=__vmarkParent(q)){
    var qr=q.getBoundingClientRect();
    if(qr.height===0&&getComputedStyle(q).overflow!=='visible')return false;
  }
  return true;
}
function __vmarkNotActable(el){
  var why=__vmarkHiddenBy(el);
  if(why==='hidden')return 'hidden';
  if(!__vmarkRendered(el))return 'hidden';
  if(why==='inert')return 'inert';
  if(__vmarkHasLayout()&&getComputedStyle(el).pointerEvents==='none')return 'inert';
  return null;
}
function __vmarkActable(el){return __vmarkNotActable(el)===null;}
function __vmarkToken(s){return /^[A-Za-z0-9_-]{1,32}$/.test(s)?s:'';}
function __vmarkDescribe(el){
  var out=__vmarkToken(String(el.tagName||'').toLowerCase())||'element',n=0;
  var cls=(typeof el.className==='string')?el.className:(el.getAttribute?(el.getAttribute('class')||''):'');
  var parts=cls.trim().split(/\\s+/);
  for(var i=0;i<parts.length&&n<2;i++){var tok=__vmarkToken(parts[i]);if(tok){out+='.'+tok;n++;}}
  return out.slice(0,64);
}
function __vmarkContext(el){
  var hops=0;
  for(var n=__vmarkParent(el);n&&hops++<8;n=__vmarkParent(n)){
    if(n===document.body||n===document.documentElement)break;
    var t=String(n.tagName||'').toLowerCase();
    var named=n.hasAttribute('id')||n.hasAttribute('class')||n.hasAttribute('aria-label')||n.hasAttribute('role');
    if(!named&&!/^(form|section|article|aside|nav|main|header|footer|dialog|li|tr|fieldset|table|ul|ol|label)$/.test(t))continue;
    var d=__vmarkDescribe(n),id=__vmarkToken(n.getAttribute('id')||'');
    if(id)d+='#'+id;
    var hint=__vmarkNorm(n.getAttribute('aria-label')||__vmarkContentText(n,false)).slice(0,40);
    return hint?d+' "'+hint+'"':d;
  }
  return '';
}
function __vmarkCandidateText(el){
  var ctx=__vmarkContext(el);
  return (__vmarkDescribe(el)+(ctx?' in '+ctx:'')).slice(0,80);
}
function __vmarkCandidates(els,gen){
  var out=[];
  for(var i=0;i<els.length;i++)out.push({ref:__vmarkRefForLive(els[i],gen),text:__vmarkCandidateText(els[i])});
  return out;
}
function __vmarkRelated(a,b){
  for(var n=b;n;n=__vmarkParent(n))if(n===a)return true;
  for(var m=a;m;m=__vmarkParent(m))if(m===b)return true;
  return false;
}
function __vmarkDeepHit(cx,cy){
  var hit=document.elementFromPoint(cx,cy),guard=0;
  while(hit&&hit.shadowRoot&&hit.shadowRoot.elementFromPoint&&guard++<32){
    var inner=hit.shadowRoot.elementFromPoint(cx,cy);
    if(!inner||inner===hit)break;
    hit=inner;
  }
  return hit;
}
function __vmarkOcclusion(el){
  if(!__vmarkHasLayout()||!document.elementFromPoint)return null;
  var r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  var hit=__vmarkDeepHit(cx,cy);
  if(!hit)return {reason:'offscreen'};
  if(hit===el||__vmarkRelated(el,hit))return null;
  return {reason:'obscured',by:__vmarkDescribe(hit)};
}
function __vmarkObscuredBy(el){var o=__vmarkOcclusion(el);return (o&&o.by)||null;}
function __vmarkPageText(){
  var b=document.body,t=String((b&&(b.innerText||b.textContent))||'');
  var all=__vmarkAll(document);
  for(var i=0;i<all.length;i++){
    var sr=all[i].shadowRoot;
    if(!sr||!sr.children)continue;
    for(var j=0;j<sr.children.length;j++){
      var c=sr.children[j];
      t+=' '+String((typeof c.innerText==='string'?c.innerText:c.textContent)||'');
    }
  }
  return t;
}
var __vmarkLevels={H1:1,H2:2,H3:3,H4:4,H5:5,H6:6};
function __vmarkSnapshot(gen){
  var all=__vmarkAll(document),out=[],truncated=false;
  for(var i=0;i<all.length;i++){
    var el=all[i],role=__vmarkRole(el);
    if(!role||__vmarkHidden(el))continue;
    if(out.length>=2000){truncated=true;break;}
    var full=__vmarkNameFull(el);
    if(full.length>__vmarkNameMax())truncated=true;
    var node={role:role,name:full.slice(0,__vmarkNameMax()),ref:__vmarkRefFor(el,gen)};
    if(role==='heading')node.level=__vmarkLevels[el.tagName]||(Number(el.getAttribute('aria-level'))||undefined);
    if(role==='checkbox'||role==='radio')node.checked=__vmarkChecked(el);
    if(__vmarkDisabled(el))node.disabled=true;
    if(__vmarkIsFileInput(el))node.upload=true;
    out.push(node);
  }
  return {nodes:out,truncated:truncated,unreachable:__vmarkUnreachable(all)};
}`;

/** Standalone core/refs/query/snapshot/click/type library, injected verbatim.
 *  Exported so sibling injected-script modules (`interactScript.ts`,
 *  `powerScript.ts`) can prepend it and reuse `__vmarkQueryByRef` / `__vmarkQuery`
 *  / `__vmarkRefFor` / `__vmarkAll`. */
export const AGENT_LIB = [AGENT_CORE_SRC, LIB_REFS, LIB_QUERY, AGENT_ACT].join("\n");
