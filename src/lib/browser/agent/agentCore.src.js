// The shared perception core (audit 2026-09-03, S-02) — THE ONLY COPY of the
// role / accessible-name / visibility rules the AI-facing scripts run in a page.
//
// Two hosts execute these exact bytes:
//   - the isolated-world agent library: `agentLib.ts` prepends this file (via
//     `?raw`) to every driver script, so snapshot, query, click and type all see a
//     page through it;
//   - the page-world recorder shim: Rust (`recorder_shim_macos.rs`) concat!s this
//     file and `recorderShim.src.js` inside one IIFE, and `recorderShim.ts`
//     assembles the identical string for the jsdom and WebKit tests.
// So what the recorder writes is, by construction, what the replayer resolves.
// `aria.ts` is the TypeScript mirror the workflow engine types against; it cannot
// eval this asset (VMark's webview CSP carries no 'unsafe-eval'), so
// `ariaParity.test.ts` holds it to the same answers element by element.
//
// Discipline, pinned by `agentCore.test.ts`:
//   - function declarations ONLY at the top level, every one `__vmark`-prefixed —
//     no statements, no side effects, nothing a page can observe until a call;
//   - self-contained ES5 (no let/const/class/arrow/template), nothing imported;
//   - a field's VALUE property is never read: the recorder shim ships these bytes,
//     and its Rust include pins that a typed value can never enter its buffer.

/** Whitespace-collapse, trim, NFC-normalise, and strip Unicode FORMAT characters
 *  (zero-width, bidi controls, word joiner and invisible operators, BOM, soft
 *  hyphen) — S-09: "Publ<ZWSP>ish" and "Publish" are one name, and a bidi override
 *  can neither split a name from itself nor restyle the approval prompt. */
function __vmarkNorm(s) {
  s = s == null ? "" : String(s);
  if (s.normalize) {
    try { s = s.normalize("NFC"); } catch (e) {}
  }
  // Zero-width space/joiners and marks, bidi embeddings/overrides/pop, bidi
  // ISOLATES (U+2066–U+2069) and the Arabic letter mark (U+061C), word joiner and
  // invisible operators, BOM, soft hyphen. The isolates were missing: an isolate
  // pair reorders a name's display exactly like an override does.
  return s.replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, "").replace(/\s+/g, " ").trim();
}

/** Accessible-name cap (S-06): the name the snapshot shows AND the name a locator
 *  matches, so a capped name still targets its element. */
function __vmarkNameMax() {
  return 200;
}

/** Composed-tree parent: the parent element, or the HOST when `n` is a top-level
 *  child of a shadow root. Every ancestor walk uses this, so a hidden host hides its
 *  shadow tree and occlusion relatedness crosses the boundary (S-05). */
function __vmarkParent(n) {
  if (!n) return null;
  if (n.parentElement) return n.parentElement;
  var p = n.parentNode;
  return p && p.host && p.host.nodeType === 1 ? p.host : null;
}

/** The element's OWN hidden-ness, no ancestor walk. */
function __vmarkSelfHidden(n) {
  if (n.hasAttribute("hidden")) return true;
  if (n.getAttribute("aria-hidden") === "true") return true;
  var s = n.style;
  return !!(s && (s.display === "none" || s.visibility === "hidden"));
}

/** Why `el` is not perceivable: 'hidden' (hidden / aria-hidden / inline display or
 *  visibility on it or an ancestor), 'inert' (only an `inert` ancestor-or-self), or
 *  null. 'hidden' outranks 'inert' wherever both apply (S-04). */
function __vmarkHiddenBy(el) {
  var inert = false;
  for (var n = el; n; n = __vmarkParent(n)) {
    if (n.nodeType !== 1) break;
    if (__vmarkSelfHidden(n)) return "hidden";
    if (n.hasAttribute("inert")) inert = true;
  }
  return inert ? "inert" : null;
}

function __vmarkHidden(el) {
  return __vmarkHiddenBy(el) !== null;
}

/** Implicit role per `<input type>`. Types not listed keep the textbox fallback:
 *  strict ARIA exposes no role for color/date/file, but an agent still has to be
 *  able to target them (a file input is targetable, and refused as an upload, never
 *  filled). `hidden` is the one type with genuinely no role. */
function __vmarkInputRole(ty) {
  var map = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", image: "button",
    range: "slider", number: "spinbutton", search: "searchbox", hidden: null };
  return Object.prototype.hasOwnProperty.call(map, ty) ? map[ty] : "textbox";
}

/** ARIA role, or null when the element has no meaningful role. An explicit `role`
 *  is a token list — the first RECOGNIZED token wins, case-insensitively; a list
 *  with no recognized token falls back to the implicit role (role="bogus button"
 *  used to become the nonexistent role "bogus"). */
function __vmarkRole(el) {
  var r = el.getAttribute("role");
  if (r && r.trim()) {
    var tokens = r.trim().toLowerCase().split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      if (!__vmarkKnownRole(tokens[i])) continue;
      if (tokens[i] === "presentation" || tokens[i] === "none") {
        // Presentational-role conflict resolution (mirrors ariaRole.ts).
        if (__vmarkPresentationalConflict(el)) break;
        return null;
      }
      return tokens[i];
    }
  }
  var t = String(el.tagName || "").toLowerCase();
  if (__vmarkEditingHost(el) && t !== "input" && t !== "textarea" && t !== "select") return "textbox";
  if (/^h[1-6]$/.test(t)) return "heading";
  switch (t) {
    case "button": case "summary": return "button";
    case "a": return el.hasAttribute("href") ? "link" : null;
    case "nav": return "navigation";
    case "main": return "main";
    case "textarea": return "textbox";
    case "select": return el.hasAttribute("multiple") || Number(el.getAttribute("size") || "1") > 1 ? "listbox" : "combobox";
    case "img": return "img";
    case "input": return __vmarkInputRole((el.getAttribute("type") || "text").toLowerCase());
    default: return null;
  }
}

/** Landmark roles never take a name from content (accname §4.3, S-06). */
function __vmarkIsLandmark(role) {
  return /^(main|navigation|banner|contentinfo|complementary|region|form|search)$/.test(String(role));
}

function __vmarkIsFileInput(el) {
  return String(el.tagName || "").toLowerCase() === "input" && (el.getAttribute("type") || "").toLowerCase() === "file";
}

/** The tree that scopes id references for `el`: its shadow root, else its document. */
function __vmarkRootOf(el) {
  var r = el.getRootNode ? el.getRootNode() : null;
  return r && r.getElementById ? r : el.ownerDocument;
}

/** Text alternative from content (accname 2F/2G subset): text nodes, image alt,
 *  <br> as a space; hidden descendants and script/style/template skipped unless
 *  `all` (a labelledby traversal whose referenced node was itself hidden). */
function __vmarkContentText(el, all) {
  var out = "";
  for (var c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) { out += c.data; continue; }
    if (c.nodeType !== 1) continue;
    var t = String(c.tagName || "").toLowerCase();
    if (t === "script" || t === "style" || t === "template" || t === "noscript") continue;
    if (!all && __vmarkSelfHidden(c)) continue;
    if (t === "br") { out += " "; continue; }
    if (t === "img") { out += c.getAttribute("alt") || ""; continue; }
    out += __vmarkContentText(c, all);
  }
  return out;
}

/** Text of the elements an id-list attribute references (aria-labelledby). Each
 *  reference contributes its own aria-label if it has one, else its content —
 *  including hidden content, since a hidden referenced node still names. The
 *  reference's own aria-labelledby is NOT followed (accname forbids the recursion). */
function __vmarkIdListText(el, ids) {
  var root = __vmarkRootOf(el),
    out = [],
    parts = String(ids).trim().split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    var ref = parts[i] && root ? root.getElementById(parts[i]) : null;
    if (!ref) continue;
    var al = ref.getAttribute("aria-label");
    out.push(al && al.trim() ? al : __vmarkContentText(ref, __vmarkSelfHidden(ref)));
  }
  return __vmarkNorm(out.join(" "));
}

/** Every <label> associated with a control, in document order — the platform's
 *  own `labels` association (for= and wrapping), else a wrapping <label> for a
 *  custom control the platform associates nothing with. */
function __vmarkLabelText(el) {
  var labels = null;
  try { labels = el.labels; } catch (e) {}
  if (labels && labels.length) {
    var parts = [];
    for (var i = 0; i < labels.length; i++) parts.push(__vmarkContentText(labels[i], false));
    return __vmarkNorm(parts.join(" "));
  }
  var wrap = el.closest ? el.closest("label") : null;
  return wrap ? __vmarkNorm(__vmarkContentText(wrap, false)) : "";
}

/** Name of a form control: label → (image button) alt → placeholder → button value. */
function __vmarkControlName(el) {
  var label = __vmarkLabelText(el);
  if (label) return label;
  var ty = (el.getAttribute("type") || "").toLowerCase();
  if (ty === "image") {
    var alt = __vmarkNorm(el.getAttribute("alt"));
    if (alt) return alt;
  }
  var ph = el.getAttribute("placeholder");
  if (ph && ph.trim()) return __vmarkNorm(ph);
  if (ty === "submit" || ty === "button" || ty === "reset" || ty === "image") {
    var v = el.getAttribute("value");
    if (v && v.trim()) return __vmarkNorm(v);
  }
  return "";
}

/** The uncapped accessible name: aria-labelledby → aria-label → (landmark: title
 *  only) → img alt → control name → content → title. Every source normalised. */
function __vmarkNameFull(el) {
  var lb = el.getAttribute("aria-labelledby");
  if (lb && lb.trim()) {
    var t = __vmarkIdListText(el, lb);
    if (t) return t;
  }
  var al = el.getAttribute("aria-label");
  if (al && al.trim()) return __vmarkNorm(al);
  if (__vmarkIsLandmark(__vmarkRole(el))) return __vmarkNorm(el.getAttribute("title"));
  var tag = String(el.tagName || "").toLowerCase();
  if (tag === "img") return __vmarkNorm(el.getAttribute("alt"));
  // A control named only by its title still gets a locator name (mirrors ariaName.ts).
  if (tag === "input" || tag === "textarea" || tag === "select") return __vmarkControlName(el) || __vmarkNorm(el.getAttribute("title"));
  var text = __vmarkNorm(__vmarkContentText(el, false));
  return text || __vmarkNorm(el.getAttribute("title"));
}

/** The accessible name the snapshot shows and a locator matches — capped. */
function __vmarkName(el) {
  return __vmarkNameFull(el).slice(0, __vmarkNameMax());
}

/** Effective disabled state, including inherited disablement (`:disabled` inside a
 *  disabled fieldset) and a bare `disabled` on a custom control. */
function __vmarkDisabled(el) {
  if (el.getAttribute("aria-disabled") === "true") return true;
  try { if (el.matches && el.matches(":disabled")) return true; } catch (e) {}
  return el.hasAttribute("disabled");
}

/** Checked state from the LIVE property — the attribute never moves. */
function __vmarkChecked(el) {
  if (String(el.tagName || "").toUpperCase() === "INPUT") return !!el.checked;
  return el.getAttribute("aria-checked") === "true";
}

/** Every element under `root` (a Document, ShadowRoot or Element; root itself is
 *  excluded) in composed pre-order: an element, then its OPEN shadow tree, then its
 *  light children (S-05). Closed roots are invisible by definition — see
 *  `__vmarkUnreachable` for what this walk cannot enter. */
function __vmarkAll(root) {
  var out = [],
    stack = [];
  __vmarkPushKids(stack, root || document);
  while (stack.length) {
    var el = stack.pop();
    out.push(el);
    __vmarkPushKids(stack, el);
    var sr = null;
    try { sr = el.shadowRoot; } catch (e) {}
    if (sr) __vmarkPushKids(stack, sr);
  }
  return out;
}

function __vmarkPushKids(stack, node) {
  var kids = node && node.children;
  if (!kids) return;
  for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
}

/** What the composed walk could not enter, so the model knows the snapshot is not
 *  the whole page: frames (evals target the main frame only), and custom-element
 *  hosts exposing no open shadow root — the population where a closed root hides.
 *  A closed root cannot be observed from outside, so `closedShadowRoots` is a
 *  proxy, not a count: a light-DOM custom element is counted too, and a plain
 *  `<div>` hosting a closed root is not. */
function __vmarkUnreachable(all) {
  var closed = 0,
    frames = 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i],
      t = String(el.tagName || "").toLowerCase();
    if (t === "iframe" || t === "frame") frames++;
    else if (t.indexOf("-") > 0 && !el.shadowRoot) closed++;
  }
  return { closedShadowRoots: closed, frames: frames };
}
