/**
 * Injected gate-signals script (WI-NB2.2) — the DOM half of gate detection.
 *
 * Purpose: one isolated-world round trip after a navigation collecting the
 * signals `classifyGate` consumes: `{url, title, textHead, challengeWidget,
 * passwordField}`. Collection only — every judgement lives in `lib/browser/
 * gates.ts`, which is leaf-pure and corpus-tested.
 *
 * Key decisions:
 *   - The widget check is a LAYOUT fact where layout exists: a challenge frame
 *     counts only when rendered above 40x40 CSS px and not style-hidden — the
 *     NeoBrowser guard that keeps invisible score-based captchas (reCAPTCHA v3,
 *     managed Turnstile on ordinary checkouts) from reading as challenges.
 *     Where no layout engine exists (jsdom), both checks degrade to the
 *     attribute tier, mirroring actScript's `__vmarkHasLayout` convention.
 *   - The probe is built on the shared perception core (audit 2026-09-03 S-02 /
 *     S-05): hidden-ness is `__vmarkHidden` (one definition, composed-parent
 *     aware), and the selectors run over the document AND every open shadow root
 *     the composed walk finds — a login form or challenge widget rendered by a
 *     web component is no longer invisible to gate detection.
 *   - Field visibility has two tiers, in a fixed order (audit round 2, #114): the
 *     computed-style tier (visibility/display/opacity, up the ancestor chain)
 *     needs no layout and runs in every engine; the box-size tier runs only where
 *     `__vmGateHasLayout`. The check is LOCAL to this script — it ships with the
 *     perception core only, never the agent library, so it must not call
 *     `__vmarkRendered`; `gateScript.test.ts` asserts that.
 *   - Standalone ES5, no imports, ends in `return JSON.stringify(...)` — the
 *     `browser_eval` calling convention.
 *
 * @coordinates-with lib/browser/gates.ts — consumes these signals
 * @coordinates-with lib/browser/agent/agentCore.src.js — hidden-ness and the composed walk
 * @coordinates-with services/mcpBridge/v2/browserGateProbe.ts — runs this script
 * @module lib/browser/agent/gateScript
 */

import { AGENT_CORE_SRC } from "./agentCore";

const GATE_LIB = `
function __vmGateHasLayout(){
  var d=document.documentElement;
  if(!d||!d.getBoundingClientRect)return false;
  var r=d.getBoundingClientRect();
  return r.width>0||r.height>0;
}
function __vmGateWidgetVisible(el){
  if(__vmarkHidden(el))return false;
  if(!__vmGateHasLayout())return true;
  var r=el.getBoundingClientRect();
  if(r.width<=40||r.height<=40)return false;
  var cs=getComputedStyle(el);
  return cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0';
}
function __vmGateFieldVisible(el){
  if(__vmarkHidden(el))return false;
  // A box alone is not visibility: visibility:hidden, display:none up the tree and
  // opacity:0 all keep a box, and a hidden password field is not a login gate.
  // Computed style needs no layout, so this tier runs everywhere. It is LOCAL —
  // this script ships with the perception core only, not the agent library.
  var cs=getComputedStyle(el);
  if(cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0')return false;
  // The COMPOSED parent chain (__vmarkParent, from the core): a shadow host with
  // opacity:0 hides its whole shadow tree, and parentElement stops at the root.
  for(var p=__vmarkParent(el);p;p=__vmarkParent(p)){var ps=getComputedStyle(p);if(ps.display==='none'||ps.opacity==='0')return false;}
  if(!__vmGateHasLayout())return true;
  var r=el.getBoundingClientRect();
  return r.width>0&&r.height>0;
}
function __vmGateSelect(sel){
  var roots=[document],all=__vmarkAll(document),out=[];
  for(var i=0;i<all.length;i++)if(all[i].shadowRoot)roots.push(all[i].shadowRoot);
  for(var r=0;r<roots.length;r++){
    var found=roots[r].querySelectorAll(sel);
    for(var j=0;j<found.length;j++)out.push(found[j]);
  }
  return out;
}
function __vmGateSignals(){
  var widget=false;
  try{
    var frames=__vmGateSelect(
      'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],div.cf-turnstile,#challenge-form,iframe[title*="challenge" i]');
    for(var i=0;i<frames.length;i++){if(__vmGateWidgetVisible(frames[i])){widget=true;break;}}
  }catch(e){}
  var pw=false;
  try{
    var fields=__vmGateSelect('input[type="password"]');
    for(var j=0;j<fields.length;j++){if(__vmGateFieldVisible(fields[j])){pw=true;break;}}
  }catch(e){}
  var text='';
  try{
    var b=document.body;
    // innerText is what a user sees; an EMPTY innerText means nothing is visible
    // and must not fall through to textContent (hidden text). Only its absence does.
    text=String((b&&(typeof b.innerText==='string'?b.innerText:b.textContent))||'').slice(0,4000);
  }catch(e){}
  var href='';
  try{href=String(location.href||'');}catch(e){}
  return {url:href,title:String(document.title||''),textHead:text,challengeWidget:widget,passwordField:pw};
}`;

/** Script: collect one `GateSignals` snapshot (see `lib/browser/gates.ts`). */
export function buildGateSignalsScript(): string {
  return `${AGENT_CORE_SRC}\n${GATE_LIB}\nreturn JSON.stringify(__vmGateSignals());`;
}
