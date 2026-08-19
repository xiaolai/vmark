// The page-world recorder-capture shim (WI-NB7.1) — THE ONLY COPY.
//
// Injected verbatim by Rust (`recorder_shim_macos.rs` include_str!s this file) into
// AiSandbox tabs' page world at document start, and executed byte-identical by
// `recorderShim.test.ts` in jsdom — one canonical asset, so the tested bytes ARE the
// shipped bytes (the console-shim lesson).
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
// It records the LOCATOR (ARIA role + accessible name) and, for a typed field, a
// `sensitive` HINT read from the field's own type/autocomplete — NEVER the typed
// value. A value never enters this buffer, so it cannot leak through it. Trusted
// host-side redaction (recorder.ts) makes the final call regardless of this hint.
//
// Must stay self-contained ES5, safe on any hostile page: every handler is wrapped so
// capture can never break the page, and CAP bounds a hostile page's writes.
(function () {
  var BUF_ID = "__vmark_recorder_buffer";
  var ARMED_ID = "__vmark_recorder_armed";
  var CAP = 200,
    MAXLEN = 120,
    buf = [];

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

  function clip(s) {
    return (s == null ? "" : String(s)).slice(0, MAXLEN);
  }

  function attr(el, name) {
    try {
      return (el.getAttribute && el.getAttribute(name)) || "";
    } catch (e) {
      return "";
    }
  }

  function idText(ids) {
    var out = [],
      parts = String(ids).split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var n = parts[i] && document.getElementById(parts[i]);
      if (n && n.textContent) out.push(n.textContent);
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
  }

  function labelText(el) {
    try {
      if (el.labels && el.labels.length) {
        var t = "";
        for (var i = 0; i < el.labels.length; i++) t += " " + (el.labels[i].textContent || "");
        return t.replace(/\s+/g, " ").trim();
      }
    } catch (e) {}
    return "";
  }

  function accName(el) {
    var v = attr(el, "aria-label");
    if (v) return clip(v);
    var lb = attr(el, "aria-labelledby");
    if (lb) {
      var t = idText(lb);
      if (t) return clip(t);
    }
    var lab = labelText(el);
    if (lab) return clip(lab);
    v = attr(el, "placeholder");
    if (v) return clip(v);
    v = attr(el, "title");
    if (v) return clip(v);
    v = attr(el, "alt");
    if (v) return clip(v);
    var txt = "";
    try {
      txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    } catch (e) {}
    return clip(txt);
  }

  function roleOf(el) {
    var r = attr(el, "role");
    if (r) return clip(r);
    var tag = "";
    try {
      tag = (el.tagName || "").toLowerCase();
    } catch (e) {}
    if (tag === "a") return attr(el, "href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      var it = (attr(el, "type") || "text").toLowerCase();
      if (it === "checkbox") return "checkbox";
      if (it === "radio") return "radio";
      if (it === "button" || it === "submit" || it === "reset" || it === "image") return "button";
      if (it === "range") return "slider";
      return "textbox";
    }
    return tag || "generic";
  }

  function isSensitive(el) {
    try {
      var it = (attr(el, "type") || "").toLowerCase();
      if (it === "password") return true;
      var ac = (attr(el, "autocomplete") || "").toLowerCase();
      if (ac.indexOf("password") >= 0 || ac.indexOf("cc-number") >= 0 || ac === "one-time-code") return true;
    } catch (e) {}
    return false;
  }

  function record(ev) {
    if (!armed()) return;
    buf.push(ev);
    if (buf.length > CAP) buf.shift();
    try {
      bufEl().textContent = JSON.stringify(buf);
    } catch (e) {}
  }

  // A clicked node may be a child of the real control (an icon inside a button):
  // walk up to the nearest interactive/role-bearing ancestor, bounded.
  function control(el) {
    var n = el,
      hops = 0;
    while (n && n.nodeType === 1 && hops++ < 8) {
      var tag = (n.tagName || "").toLowerCase();
      if (tag === "button" || tag === "a" || tag === "select" || tag === "textarea" || tag === "input") return n;
      if (n.getAttribute && n.getAttribute("role")) return n;
      n = n.parentNode;
    }
    return el;
  }

  try {
    document.addEventListener(
      "click",
      function (e) {
        try {
          var el = control(e.target);
          record({ type: "click", role: roleOf(el), name: accName(el) });
        } catch (x) {}
      },
      true,
    );
    document.addEventListener(
      "change",
      function (e) {
        try {
          var el = e.target;
          if (!el || el.nodeType !== 1) return;
          var tag = (el.tagName || "").toLowerCase();
          if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
          if (tag === "input") {
            var it = (attr(el, "type") || "text").toLowerCase();
            // A checkbox/radio toggle is already captured by the click handler.
            if (it === "checkbox" || it === "radio") return;
          }
          record({ type: "type", role: roleOf(el), name: accName(el), sensitive: isSensitive(el) });
        } catch (x) {}
      },
      true,
    );
  } catch (e) {}
})();
