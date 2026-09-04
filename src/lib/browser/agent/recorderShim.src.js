// The page-world recorder-capture shim (WI-NB7.1) — THE ONLY COPY of the capture
// logic, written as a BODY. The includer wraps it, with the shared perception core
// first, as
//     (function(){ <agentCore.src.js> <this file> })();
// Rust (`recorder_shim_macos.rs`) concat!s exactly that for injection into AI-owned
// tabs' page world at document start; `recorderShim.ts` assembles the identical
// string as RECORDER_SHIM_SRC, which `recorderShim.test.ts` (jsdom) and
// `recorder.webkit.test.ts` (real WebKit) execute — the tested bytes ARE the
// shipped bytes. `__vmarkRole` / `__vmarkName` / `__vmarkParent` come from the core
// (audit 2026-09-03 S-02): the recorder used to carry its own role and name rules,
// which drifted from the replayer's, so it emitted locators the replayer could not
// resolve. Now a recorded locator resolves by construction; a target the core gives
// no role is recorded WITHOUT `role`, and the trusted converter turns that into a
// human `confirm:` step rather than a dead `click "x"`.
//
// DORMANT until ARMED: it captures nothing unless a hidden marker element
// (__vmark_recorder_armed) is present, which the isolated-world driver adds on record
// start and re-adds after every navigation while a recording session is active. A new
// document has neither the marker nor the buffer, so the shim is dormant again until
// re-armed — cross-document capture is host-orchestrated, not page-persisted.
//
// Captures `click` and `change` (field-commit) into a capped ring buffer on a hidden
// DOM element (__vmark_recorder_buffer). The isolated-world driver reads that element —
// the DOM is shared across content worlds, so NO WKScriptMessageHandler is registered
// and the no-bridge invariant (R3) holds: the page has no channel into VMark.
//
// The host's clearing drain stamps `data-drain` on the element (S-01); before every
// push the shim compares that stamp with the one it last saw and drops its closure
// copy when it moved, so a drained event is never re-published. A page that forges
// the stamp only discards its own buffered events.
//
// It records the LOCATOR (ARIA role + accessible name) and, for a typed field, a
// `sensitive` HINT — NEVER the typed value. Sensitivity (S-11) is read from
// type=password (at ANY point of the interaction: it is marked on focus/input and
// stays sticky per element until change/focusout, so a show-password toggle cannot
// launder it), from `autocomplete` tokens (`cc-*`, new-/current-password,
// one-time-code), from name/id/aria-label words (otp, token, cvv, cvc, csc, ssn,
// secret, pin, passcode), and from type=file (an upload is a human gate at replay).
// A value never enters this buffer, so it cannot leak through it. Trusted host-side
// redaction (recorder.ts) makes the final call regardless of this hint.
//
// Must stay self-contained ES5, safe on any hostile page: every handler is wrapped so
// capture can never break the page, and CAP bounds a hostile page's writes.
var BUF_ID = "__vmark_recorder_buffer";
var ARMED_ID = "__vmark_recorder_armed";
var CAP = 200;
var buf = [];
var seenDrain = "";
/** The control a <label> click just resolved to: the browser fires that control's
 *  own activation click next, and the pair is ONE user action. Only a label-origin
 *  click arms this — two direct clicks on the same control are two actions. */
var labelActivation = null;
function armed() {
  try {
    return !!document.getElementById(ARMED_ID);
  } catch (e) {
    return false;
  }
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

function attr(el, name) {
  try {
    return (el.getAttribute && el.getAttribute(name)) || "";
  } catch (e) {
    return "";
  }
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

// A clicked node may be a child of the real control (an icon inside a button):
// walk up to the nearest interactive/role-bearing ancestor, bounded, crossing a
// shadow boundary into the host.
function control(el) {
  // A click on a <label> (or inside one) operates its control: record the
  // checkbox, radio or input the user actually toggled, not a roleless label.
  try {
    var lab = el.closest ? el.closest("label") : null;
    if (lab) {
      var c = lab.control;
      if (c === undefined) {
        var f = lab.getAttribute("for");
        c = f ? __vmarkRootOf(lab).getElementById(f) : lab.querySelector("input,select,textarea,button");
      }
      if (c) return c;
    }
  } catch (x) {}
  var n = el,
    hops = 0;
  while (n && n.nodeType === 1 && hops++ < 8) {
    var tag = (n.tagName || "").toLowerCase();
    if (tag === "button" || tag === "a" || tag === "select" || tag === "textarea" || tag === "input" || tag === "summary") return n;
    if (n.getAttribute && n.getAttribute("role")) return n;
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
        var now = Date.now();
        var fromLabel = ctrl !== el && !!(el.closest && el.closest("label"));
        if (fromLabel) {
          // A click on a <label> resolves to its control AND the browser then fires
          // the control's own activation click: one user action, recorded once — here.
          labelActivation = { el: ctrl, at: now };
        } else if (labelActivation && labelActivation.el === ctrl && now - labelActivation.at < 100) {
          // The activation click the label just caused: already recorded.
          labelActivation = null;
          return;
        }
        record(locator("click", ctrl));
      } catch (x) {}
    },
    true,
  );
  document.addEventListener("focusin", onMark, true);
  document.addEventListener("input", onMark, true);
  // contenteditable never fires `change`: track edits and emit ONE value-free
  // type event when the region loses focus, so what the replayer can type into
  // is also what the recorder captures.
  var dirtyEditable = typeof WeakMap === "function" ? new WeakMap() : null;
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
        if (host && dirtyEditable) dirtyEditable.set(host, true);
      } catch (x) {}
    },
    true,
  );
  document.addEventListener(
    "focusout",
    function (e) {
      try {
        var el = target(e);
        el = el && el.nodeType === 1 ? editingHost(el) : null;
        if (!el || !dirtyEditable || !dirtyEditable.get(el)) return;
        dirtyEditable.delete(el);
        var ev = locator("type", el);
        ev.sensitive = wasSensitive(el) || isSensitiveNow(el);
        clearSensitive(el);
        record(ev);
      } catch (x) {}
    },
    true,
  );
  document.addEventListener(
    "focusout",
    function (e) {
      try {
        var el = target(e);
        if (el && el.nodeType === 1) clearSensitive(el);
      } catch (x) {}
    },
    true,
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
        var ev = locator("type", el);
        ev.sensitive = wasSensitive(el) || isSensitiveNow(el);
        clearSensitive(el);
        record(ev);
      } catch (x) {}
    },
    true,
  );
} catch (e) {}
