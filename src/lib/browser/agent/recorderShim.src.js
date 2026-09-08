// The page-world recorder-capture shim (WI-NB7.1) — THE ONLY COPY of the capture
// logic, written as a BODY. The includer wraps it, with the shared perception core
// first, as `(function(){ <agentCore.src.js> <this file> })();`. Rust
// (`recorder_shim_macos.rs`) concat!s exactly that for injection into AI-owned tabs'
// page world at document start; `recorderShim.ts` assembles the identical string as
// RECORDER_SHIM_SRC, which `recorderShim.test.ts` (jsdom) and
// `recorder.webkit.test.ts` (real WebKit) execute — the tested bytes ARE the shipped
// bytes. `__vmarkRole` / `__vmarkName` / `__vmarkParent` come from the core (audit
// 2026-09-03 S-02): the recorder's own role and name rules had drifted from the
// replayer's, so it emitted locators the replayer could not resolve. Now a recorded
// locator resolves by construction; a target the core gives no role is recorded
// WITHOUT `role`, and the converter turns that into a human `confirm:` step.
//
// DORMANT until ARMED: it captures nothing unless a hidden marker element
// (__vmark_recorder_armed) is present, which the isolated-world driver adds on record
// start and re-adds after every navigation while a session is active; that element
// also IDENTIFIES the session. A new document has neither marker nor buffer, so the
// shim is dormant until re-armed — capture is host-orchestrated, not page-persisted.
//
// Captures `click` and `change` (field-commit) into a capped ring buffer on a hidden
// DOM element (__vmark_recorder_buffer), which the isolated-world driver reads: the
// DOM is shared across content worlds, so NO WKScriptMessageHandler is registered and
// the no-bridge invariant (R3) holds — the page has no channel into VMark.
//
// The host's clearing drain stamps `data-drain` on the element (S-01); before every
// push the shim compares that stamp — and the element's IDENTITY — with what it last
// saw, dropping its closure copy when either moved, so a drained event is never
// re-published. Forging the stamp only discards the page's own buffered events.
//
// It records the LOCATOR (ARIA role + accessible name) and, for a typed field, a
// `sensitive` HINT — NEVER the typed value. The sensitivity rules, the two marks
// that carry an observation across an attribute rewrite, and the vocabulary that
// names a secret all live in `recorderShimSensitivity.src.js` (S-11, WI-FL6.4 +
// audit 20260907), which this file is concatenated with. A value never enters this
// buffer; trusted host-side redaction (recorder.ts) makes the final call.
//
// Self-contained ES5, safe on any hostile page: every handler is wrapped so capture
// cannot break the page, and CAP bounds a hostile page's writes.
var BUF_ID = "__vmark_recorder_buffer";
var ARMED_ID = "__vmark_recorder_armed";
var CAP = 200;
var buf = [];
var seenDrain = "";
/** The buffer element this closure last published into — see `bufEl`. */
var bufNode = null;
/** The control a <label> click just resolved to: the browser fires that control's
 *  own activation click SYNCHRONOUSLY, same task, and the pair is ONE user action.
 *  Armed only by a label-origin click and cleared on the next task, so a cancelled
 *  label click cannot swallow a later genuine click on the control. */
var labelActivation = null;
/** The armed marker ELEMENT — new per record start, so it identifies the SESSION. */
function session() {
  try {
    return document.getElementById(ARMED_ID);
  } catch (e) {
    return null;
  }
}
function armed() {
  return !!session();
}

function bufEl() {
  var e = document.getElementById(BUF_ID);
  if (!e) {
    e = document.createElement("script");
    e.type = "application/json";
    e.id = BUF_ID;
    e.style.display = "none";
    (document.head || document.documentElement).appendChild(e);
  }
  // IDENTITY, not just the stamp: a page that removes the element between the
  // host's clearing drain and the next capture gets a fresh one stamped "" —
  // equal to the "" this closure still held, since no capture had run to see
  // the real stamp — and the drained events were republished (round 2).
  if (e !== bufNode) {
    bufNode = e;
    buf = [];
    seenDrain = drainStamp(e);
  }
  return e;
}

function drainStamp(e) {
  try {
    return e.getAttribute("data-drain") || "";
  } catch (x) {
    return "";
  }
}

function record(ev) {
  if (!armed()) return;
  var e;
  try {
    e = bufEl();
  } catch (x) {
    return;
  }
  var stamp = drainStamp(e);
  if (stamp !== seenDrain) {
    buf = [];
    seenDrain = stamp;
  }
  buf.push(ev);
  if (buf.length > CAP) buf.shift();
  try {
    e.textContent = JSON.stringify(buf);
  } catch (x) {}
}

// The real target, not the host an event is retargeted to at the document: for a
// click inside an open shadow root `composedPath()[0]` is the element itself.
function target(e) {
  try {
    if (e.composedPath) {
      var p = e.composedPath();
      if (p && p.length) return p[0];
    }
  } catch (x) {}
  return e.target;
}

// Roles a user can ACT on. ANY `role` attribute used to stop the walk below, so a
// decorative icon inside a button was recorded instead of the button, and
// `role="presentation"` degraded the step to a manual `confirm:` (round 2). The
// core's RESOLVER is asked, not the raw attribute: implicit roles answer alike.
var ACTIONABLE_ROLE = /^(button|link|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|combobox|listbox|textbox|searchbox|slider|spinbutton|treeitem|gridcell|row|columnheader|rowheader)$/;

// A clicked node may be a child of the real control (an icon inside a button):
// walk up to the nearest interactive/actionable ancestor, crossing a shadow
// boundary into the host, until the ancestors RUN OUT. Nothing actionable
// anywhere above falls back to the clicked element itself. A <label> answers
// with its own control, but only once nothing clickable has been found BELOW
// it — resolving the label FIRST recorded a link inside "I accept the [terms]"
// as a checkbox toggle (audit R2, #772) — and an actionable ancestor above a
// control-less label still wins, because the walk simply continues.
//
// The exit condition is STRUCTURAL, not numeric (audit R3 #773): 8 hops read as
// a safety bound and behaved as a claim about markup depth, stopping inside a
// design-system button's own icon/svg/g/path wrappers and recording the roleless
// inner node. WALK_BACKSTOP only guards a parent chain that never terminates.
var WALK_BACKSTOP = 512;
function control(el) {
  var n = el,
    hops = 0;
  while (n && n.nodeType === 1 && hops++ < WALK_BACKSTOP) {
    var tag = (n.tagName || "").toLowerCase();
    if (tag === "button" || tag === "a" || tag === "select" || tag === "textarea" || tag === "input" || tag === "summary") return n;
    if (ACTIONABLE_ROLE.test(String(__vmarkRole(n)))) return n;
    if (tag === "label") {
      try {
        var c = n.control;
        if (c === undefined) {
          var f = n.getAttribute("for");
          c = f ? __vmarkRootOf(n).getElementById(f) : n.querySelector("input,select,textarea,button");
        }
        if (c) return c;
      } catch (x) {}
    }
    n = __vmarkParent(n);
  }
  return el;
}

// The locator the replayer resolves: the core's role (omitted when null) and name.
function locator(type, el) {
  var ev = { type: type };
  var role = __vmarkRole(el);
  if (role) ev.role = role;
  ev.name = __vmarkName(el);
  return ev;
}

// The ONE way a field commit is recorded — `change` and contenteditable
// focusout alike (audit R3 #779). Written twice before.
function recordTypeCommit(el) {
  flushSensitivity();
  var ev = locator("type", el);
  ev.sensitive = wasSensitive(el) || isSensitiveNow(el);
  clearSensitive(el);
  record(ev);
}

function onMark(e) {
  try {
    var el = target(e);
    if (el && el.nodeType === 1) markSensitive(el);
  } catch (x) {}
}

try {
  document.addEventListener(
    "click",
    function (e) {
      try {
        var el = target(e);
        if (!el || el.nodeType !== 1) return;
        var ctrl = control(el);
        var fromLabel = ctrl !== el && !!(el.closest && el.closest("label"));
        if (fromLabel) {
          // A click on a <label> resolves to its control AND the browser then fires
          // the control's own activation click within this task: one user action,
          // recorded once — here. The arm dies with the task.
          labelActivation = ctrl;
          setTimeout(function () {
            labelActivation = null;
          }, 0);
        } else if (labelActivation === ctrl) {
          // The activation click the label just caused: already recorded.
          labelActivation = null;
          return;
        }
        record(locator("click", ctrl));
      } catch (x) {}
    },
    true
  );
  document.addEventListener("focusin", onMark, true);
  document.addEventListener("input", onMark, true);
  // contenteditable never fires `change`: track edits and emit ONE value-free
  // type event when the region loses focus, so what the replayer can type into
  // is also what the recorder captures.
  var dirtyEditable = typeof WeakMap === "function" ? new WeakMap() : null;
  // The dirty mark is kept against `session()`: marking while DISARMED, or in an
  // earlier session, recorded a `type` step for text entered before recording
  // began (round 2).
  /** The element that OWNS an editable region: the nearest ancestor-or-self with a
   *  `contenteditable` attribute (any value but "false"). The attribute, not
   *  `isContentEditable` — that property is inherited by every descendant, and
   *  the host is the one element a replayer can focus and type into. */
  function editingHost(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var ce = n.getAttribute("contenteditable");
      if (ce !== null) return String(ce).toLowerCase() === "false" ? null : n;
    }
    return null;
  }
  document.addEventListener(
    "input",
    function (e) {
      try {
        var el = target(e);
        var host = el && el.nodeType === 1 ? editingHost(el) : null;
        var now = session();
        if (host && now && dirtyEditable) dirtyEditable.set(host, now);
      } catch (x) {}
    },
    true
  );
  document.addEventListener(
    "focusout",
    function (e) {
      try {
        var el = target(e);
        el = el && el.nodeType === 1 ? editingHost(el) : null;
        if (!el || !dirtyEditable) return;
        // Moving BETWEEN descendants of one editing host is not leaving it (audit
        // R3 #778): a focusable widget inside made every hop commit a `type` step
        // and forget the edit. A null relatedTarget means focus left the document.
        var to = e.relatedTarget;
        if (to && to.nodeType === 1 && el.contains(to)) return;
        var began = dirtyEditable.get(el);
        dirtyEditable.delete(el);
        // Commit only what THIS armed session saw begin.
        if (!began || began !== session()) return;
        recordTypeCommit(el);
      } catch (x) {}
    },
    true
  );
  document.addEventListener(
    "focusout",
    function (e) {
      try {
        var el = target(e);
        if (el && el.nodeType === 1) clearSensitive(el);
      } catch (x) {}
    },
    true
  );
  document.addEventListener(
    "change",
    function (e) {
      try {
        var el = target(e);
        if (!el || el.nodeType !== 1) return;
        var tag = (el.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
        if (tag === "input") {
          var it = (attr(el, "type") || "text").toLowerCase();
          // A checkbox/radio toggle is already captured by the click handler.
          if (it === "checkbox" || it === "radio") return;
        }
        recordTypeCommit(el);
      } catch (x) {}
    },
    true
  );
} catch (e) {}
