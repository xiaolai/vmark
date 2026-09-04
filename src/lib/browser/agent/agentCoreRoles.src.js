// agentCoreRoles.src.js — role resolution for the shared page-world core
// (`agentCore.src.js`): the role vocabulary, the implicit roles per tag and
// `<input type>` (and the file-input classification beside it), the
// presentational-conflict rule and the focusability it rests on. Split out for size; concatenated straight after the core by `agentCore.ts`
// (and by Rust's `recorder_shim_macos.rs`, pinned by recorderShimRustParity), so
// the core's `__vmarkNameFull` reaches `__vmarkRole` / `__vmarkIsLandmark` here —
// function declarations hoist within the one script. Same discipline as the core:
// self-contained ES5, top-level function declarations only, safe on any hostile
// page. `ariaRole.ts` is the TypeScript mirror; `ariaParity.test.ts` holds both to
// the same answers and pins the vocabulary list below to `KNOWN_ROLES`.

/** The role vocabulary this resolver recognizes. MUST match `KNOWN_ROLES` in
 *  ariaRole.ts (ariaParity.test.ts pins it): the two resolvers are one perception. */
function __vmarkKnownRoles() {
  return ["alert","alertdialog","application","article","banner","button","cell","checkbox","columnheader","combobox","complementary","contentinfo","definition","dialog","directory","document","feed","figure","form","grid","gridcell","group","heading","img","link","list","listbox","listitem","log","main","marquee","math","menu","menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note","option","presentation","progressbar","radio","radiogroup","region","row","rowgroup","rowheader","scrollbar","search","searchbox","separator","slider","spinbutton","status","switch","tab","table","tablist","tabpanel","term","textbox","timer","toolbar","tooltip","tree","treegrid","treeitem"];
}
function __vmarkKnownRole(token) {
  var roles = __vmarkKnownRoles();
  for (var i = 0; i < roles.length; i++) if (roles[i] === token) return true;
  return false;
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

/** A file input (S-10): perceivable so the model can name it, never actable. */
function __vmarkIsFileInput(el) {
  return String(el.tagName || "").toLowerCase() === "input" && (el.getAttribute("type") || "").toLowerCase() === "file";
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

/** Natively focusable, or made focusable by the author — a presentational role on
 *  such an element is a conflict, resolved in favour of the implicit role (ARIA §5.3). */
function __vmarkFocusable(el) {
  if (el.hasAttribute("tabindex")) return true;
  var t = String(el.tagName || "").toLowerCase();
  if (t === "button" || t === "select" || t === "textarea" || t === "summary") return true;
  if (t === "input") return (el.getAttribute("type") || "text").toLowerCase() !== "hidden";
  if (t === "a") return el.hasAttribute("href");
  return __vmarkEditingHost(el);
}
/** The element that OWNS a contenteditable region (the attribute on itself, any
 *  value but "false") — `isContentEditable` is inherited by every descendant. */
function __vmarkEditingHost(el) {
  if (!el.hasAttribute || !el.hasAttribute("contenteditable")) return false;
  return String(el.getAttribute("contenteditable") || "").toLowerCase() !== "false";
}
/** A presentational role is ignored when the element is focusable OR carries a
 *  global ARIA property (ARIA §5.3). Mirrors ariaRole.ts. */
function __vmarkPresentationalConflict(el) {
  if (__vmarkFocusable(el)) return true;
  // Every global WAI-ARIA state and property (ARIA 1.2 §6.4); mirrors ariaRole.ts GLOBAL_ARIA.
  var attrs = ["aria-atomic", "aria-busy", "aria-controls", "aria-current", "aria-describedby", "aria-description", "aria-details", "aria-disabled", "aria-dropeffect", "aria-errormessage", "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label", "aria-labelledby", "aria-live", "aria-owns", "aria-relevant", "aria-roledescription"];
  for (var i = 0; i < attrs.length; i++) if (el.hasAttribute(attrs[i])) return true;
  return false;
}
