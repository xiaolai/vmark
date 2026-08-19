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
 *   - Standalone ES5, no imports, ends in `return JSON.stringify(...)` — the
 *     `browser_eval` calling convention.
 *
 * @coordinates-with lib/browser/gates.ts — consumes these signals
 * @coordinates-with services/mcpBridge/v2/browserGateProbe.ts — runs this script
 * @module lib/browser/agent/gateScript
 */

const GATE_LIB = `
function __vmGateHasLayout(){
  var d=document.documentElement;
  if(!d||!d.getBoundingClientRect)return false;
  var r=d.getBoundingClientRect();
  return r.width>0||r.height>0;
}
function __vmGateAttrHidden(el){
  for(var n=el;n;n=n.parentElement){
    if(n.hasAttribute('hidden')||n.hasAttribute('inert'))return true;
    if(n.getAttribute('aria-hidden')==='true')return true;
    var s=n.style;
    if(s&&(s.display==='none'||s.visibility==='hidden'))return true;
  }
  return false;
}
function __vmGateWidgetVisible(el){
  if(__vmGateAttrHidden(el))return false;
  if(!__vmGateHasLayout())return true;
  var r=el.getBoundingClientRect();
  if(r.width<=40||r.height<=40)return false;
  var cs=getComputedStyle(el);
  return cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0';
}
function __vmGateFieldVisible(el){
  if(__vmGateAttrHidden(el))return false;
  if(!__vmGateHasLayout())return true;
  var r=el.getBoundingClientRect();
  return r.width>0&&r.height>0;
}
function __vmGateSignals(){
  var widget=false;
  try{
    var frames=document.querySelectorAll(
      'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],div.cf-turnstile,#challenge-form,iframe[title*="challenge" i]');
    for(var i=0;i<frames.length;i++){if(__vmGateWidgetVisible(frames[i])){widget=true;break;}}
  }catch(e){}
  var pw=false;
  try{
    var fields=document.querySelectorAll('input[type="password"]');
    for(var j=0;j<fields.length;j++){if(__vmGateFieldVisible(fields[j])){pw=true;break;}}
  }catch(e){}
  var text='';
  try{
    var b=document.body;
    text=String((b&&(b.innerText||b.textContent))||'').slice(0,4000);
  }catch(e){}
  var href='';
  try{href=String(location.href||'');}catch(e){}
  return {url:href,title:String(document.title||''),textHead:text,challengeWidget:widget,passwordField:pw};
}`;

/** Script: collect one `GateSignals` snapshot (see `lib/browser/gates.ts`). */
export function buildGateSignalsScript(): string {
  return `${GATE_LIB}\nreturn JSON.stringify(__vmGateSignals());`;
}
