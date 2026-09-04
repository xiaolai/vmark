// The shared perception core (audit 2026-09-03, S-02) — THE ONLY COPY of the
// accessible-name / visibility / composed-walk rules the AI-facing scripts run in
// a page. Role resolution and its vocabulary follow in `agentCoreRoles.src.js`,
// which every host concatenates straight after this file (one script, so the
// declarations hoist across the seam in both directions).
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
//   - self-contained ES5 (no let/const/class/arrow/template), nothing imported —
//     the `\p{Cf}` property escape (ES2018) is the one newer feature in use;
//   - a field's VALUE property is never read: the recorder shim ships these bytes,
//     and its Rust include pins that a typed value can never enter its buffer;
//   - every walk is BUDGETED and lazy (#103 / #105 / #119): a cursor per open node
//     reads children by index — never a copied child list — and text is gathered a
//     window at a time, so a hostile page can make an answer incomplete but never
//     make the webview allocate without limit. Budgets are functions, not literals,
//     so `ariaParity.test.ts` can pin the TS mirror's constants to them.

/** Whitespace-collapse, trim, NFC-normalise, and strip every Unicode FORMAT
 *  character (Cf: zero-width space/joiners and marks, bidi embeddings/overrides/
 *  pop and isolates, word joiner and invisible operators, BOM, soft hyphen) by the
 *  same property escape as ariaName.ts — S-09: "Publ<ZWSP>ish" and "Publish" are
 *  one name, and a bidi override can neither split a name nor restyle a prompt. */
function __vmarkNorm(s) {
  s = s == null ? "" : String(s);
  if (s.normalize) {
    try { s = s.normalize("NFC"); } catch (e) {}
  }
  return s.replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
}

/** Accessible-name cap (S-06): the name the snapshot shows AND the name a locator
 *  matches, so a capped name still targets its element. */
function __vmarkNameMax() {
  return 200;
}

/** Collapsed characters a name-from-content walk gathers before it stops: many
 *  times the cap, so a whitespace-heavy name still fills it, while a hostile
 *  page's megabyte of text never becomes one string. Mirrors CONTENT_BUDGET. */
function __vmarkContentBudget() {
  return __vmarkNameMax() * 16;
}

/** Elements a composed walk (`__vmarkWalk`) visits before it stops looking. Mirrors
 *  SNAPSHOT_VISIT_BUDGET, spelled without a digit separator (ES5). */
function __vmarkVisitBudget() {
  return 50000;
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

/** The tree that scopes id references for `el`: its shadow root, else its document. */
function __vmarkRootOf(el) {
  var r = el.getRootNode ? el.getRootNode() : null;
  return r && r.getElementById ? r : el.ownerDocument;
}

/** Append `text` to `out` up to `budget` characters, whitespace collapsed and
 *  format characters stripped AS GATHERED, so neither a run of spaces nor a flood
 *  of bidi controls can spend the budget. The raw text is consumed a window of
 *  `budget` characters at a time: a text node holding megabytes costs one window
 *  per pass, never a stripped copy of the whole, and a window that strips to
 *  nothing is followed by the next, so the visible text after it still names. (A
 *  format character split across two windows survives this pass at a cost of two
 *  budget units; every caller's final `__vmarkNorm` removes it.) */
function __vmarkTake(out, text, budget) {
  for (var off = 0; off < text.length && out.length < budget; off += budget) {
    var piece = text.slice(off, off + budget).replace(/\p{Cf}/gu, "").replace(/\s+/g, " ");
    if (piece.charAt(0) === " " && (!out || out.charAt(out.length - 1) === " ")) piece = piece.slice(1);
    out += piece.slice(0, budget - out.length);
  }
  return out;
}

/** Text alternative from content (accname 2F/2G subset): text nodes, image alt,
 *  <br> as a space; hidden descendants and script/style/template skipped unless
 *  `all` (a labelledby traversal whose referenced node was itself hidden). An
 *  iterative cursor walk — the stack is bounded by depth, never a copied child
 *  list — that stops once `__vmarkContentBudget()` collapsed characters are in hand. */
function __vmarkContentText(el, all) {
  var out = "", budget = __vmarkContentBudget(), stack = [{ kids: el.childNodes, i: 0 }];
  while (stack.length && out.length < budget) {
    var top = stack[stack.length - 1];
    if (!top.kids || top.i >= top.kids.length) { stack.pop(); continue; }
    var c = top.kids[top.i++];
    if (c.nodeType === 3) { out = __vmarkTake(out, c.data, budget); continue; }
    if (c.nodeType !== 1) continue;
    var t = String(c.tagName || "").toLowerCase();
    if (t === "script" || t === "style" || t === "template" || t === "noscript") continue;
    if (!all && __vmarkSelfHidden(c)) continue;
    if (t === "br") { out = __vmarkTake(out, " ", budget); continue; }
    if (t === "img") { out = __vmarkTake(out, c.getAttribute("alt") || "", budget); continue; }
    stack.push({ kids: c.childNodes, i: 0 });
  }
  return out;
}

/** The first `max` characters of an element's text — every descendant text node,
 *  as textContent would give — normalised like a name. The walk stops once `max`
 *  characters are in hand, so summarising a match that holds megabytes costs `max`
 *  characters, and textContent itself is never read (#119). */
function __vmarkTextHead(el, max) {
  var out = "", stack = [{ kids: el.childNodes, i: 0 }];
  while (stack.length && out.length < max) {
    var top = stack[stack.length - 1];
    if (!top.kids || top.i >= top.kids.length) { stack.pop(); continue; }
    var c = top.kids[top.i++];
    if (c.nodeType === 3) out = __vmarkTake(out, c.data, max);
    else if (c.nodeType === 1) stack.push({ kids: c.childNodes, i: 0 });
  }
  return __vmarkNorm(out).slice(0, max);
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

/** The composed walk every perception path runs on: each element under `root` (a
 *  Document, ShadowRoot or Element; root itself excluded) in composed pre-order —
 *  an element, then its OPEN shadow tree, then its light children (S-05) — is
 *  handed to `visit`. Lazy in both dimensions (#103): a cursor per open node reads
 *  children by index (a node a billion wide costs one cursor) and the walk stops
 *  after `budget` visited elements, returning true when it ran out with elements
 *  still unvisited so a consumer can say its answer is incomplete. Closed roots are
 *  invisible by definition — `__vmarkCountUnreachable` tallies what it cannot enter. */
function __vmarkWalk(root, budget, visit) {
  var visited = 0, stack = [{ kids: (root || document).children, i: 0 }];
  while (stack.length) {
    var top = stack[stack.length - 1];
    if (!top.kids || top.i >= top.kids.length) { stack.pop(); continue; }
    var el = top.kids[top.i++];
    if (++visited > budget) return true;
    visit(el);
    stack.push({ kids: el.children, i: 0 });
    var sr = null;
    try { sr = el.shadowRoot; } catch (e) {}
    if (sr) stack.push({ kids: sr.children, i: 0 });
  }
  return false;
}

/** Every element the budgeted walk reaches under `root`, as a list, for the
 *  consumers that need one (`gateScript`, `interactScript`, `__vmarkPageText`) —
 *  at most `__vmarkVisitBudget()` long, never the whole of a hostile page. */
function __vmarkAll(root) {
  var out = [];
  __vmarkWalk(root, __vmarkVisitBudget(), function (el) { out.push(el); });
  return out;
}

/** Tally into `counts` ({closedShadowRoots, frames}) what the composed walk could
 *  not enter at `el`, so the model knows the snapshot is not the whole page: a
 *  frame (evals target the main frame only), or a custom-element host exposing no
 *  open shadow root — where a closed root hides. A closed root cannot be observed
 *  from outside, so `closedShadowRoots` is a proxy, not a count: a light-DOM custom
 *  element is counted too, a plain `<div>` hosting a closed root is not. Per
 *  element, so a walk tallies as it goes with no element list. */
function __vmarkCountUnreachable(counts, el) {
  var t = String(el.tagName || "").toLowerCase();
  if (t === "iframe" || t === "frame") counts.frames++;
  else if (t.indexOf("-") > 0 && !el.shadowRoot) counts.closedShadowRoots++;
}

/** The tally over an element list (what `__vmarkAll` returns). */
function __vmarkUnreachable(all) {
  var counts = { closedShadowRoots: 0, frames: 0 };
  for (var i = 0; i < all.length; i++) __vmarkCountUnreachable(counts, all[i]);
  return counts;
}
