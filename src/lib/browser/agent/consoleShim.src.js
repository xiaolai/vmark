// The page-world console-capture shim (WI-P7.1 / WI-NB3.1) — THE ONLY COPY.
//
// Injected verbatim by Rust (`console_shim_macos.rs` include_str!s this file)
// into AI-owned tabs' page world at document start, and executed byte-identical
// by `consoleShim.test.ts` in jsdom — one canonical asset, so the tested bytes
// ARE the shipped bytes (the fix consoleShim.ts's header demanded).
//
// Overrides console.log/info/warn/error/debug and captures uncaught errors and
// unhandled promise rejections into a capped ring buffer on a hidden DOM
// element (`__vmark_console_buffer`). The isolated-world driver reads that
// element — the DOM is shared across content worlds, so NO WKScriptMessageHandler
// is registered and the no-bridge invariant (R3) holds: the page has no channel
// into VMark. Output is page-controlled and untrusted.
//
// The closure array is the source of truth and is rewritten into the element on
// every entry, so a host clear that only blanked the element re-published every
// drained entry on the next log (audit 2026-09-03 S-01). The host's clearing read
// now stamps `data-drain` on the element; before every push the shim compares
// that stamp with the one it last saw and drops its copy when it moved. O(1), and
// a page that forges the stamp only discards its own entries.
//
// Must stay self-contained ES5: no imports, no template literals, safe on any
// hostile page (every step wrapped; capture must never break the page's own
// logging). CAP/MAX bound a chatty or hostile page.
(function () {
  var ID = "__vmark_console_buffer", MAX = 2000, CAP = 200, buf = [], seenDrain = "";
  function el() {
    var e = document.getElementById(ID);
    if (!e) {
      e = document.createElement("script");
      e.type = "application/json";
      e.id = ID;
      e.style.display = "none";
      (document.head || document.documentElement).appendChild(e);
    }
    return e;
  }
  function stamp(e) {
    try { return e.getAttribute("data-drain") || ""; } catch (x) { return ""; }
  }
  function push(level, args) {
    var t = "";
    try {
      t = Array.prototype.map.call(args, function (a) {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(" ");
    } catch (e) { t = ""; }
    var e = null;
    try { e = el(); } catch (x) { e = null; }
    if (e) {
      var s = stamp(e);
      if (s !== seenDrain) { buf = []; seenDrain = s; }
    }
    buf.push({ level: level, text: t.slice(0, MAX) });
    if (buf.length > CAP) buf.shift();
    try { if (e) e.textContent = JSON.stringify(buf); } catch (x) {}
  }
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try { push(level, arguments); } catch (e) {}
      if (typeof orig === "function") return orig.apply(console, arguments);
    };
  });
  // Uncaught errors and unhandled rejections (WI-NB3.1): the single most useful
  // debug signal a page emits, and console.* patching never sees them. Same
  // entry shape, level "error", prefixed so the reader can tell them apart.
  try {
    window.addEventListener("error", function (ev) {
      try {
        var msg = "Uncaught " + String((ev && ev.message) || "error");
        if (ev && ev.filename) msg += " (" + ev.filename + ":" + (ev.lineno || 0) + ")";
        push("error", [msg]);
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        var r = ev && ev.reason, m;
        try { m = r && r.message ? String(r.message) : JSON.stringify(r); } catch (e2) { m = String(r); }
        push("error", ["Unhandled rejection: " + m]);
      } catch (e) {}
    });
  } catch (e) {}
})();
