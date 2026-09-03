// agentCoreRoles.src.js — the role vocabulary and focusability rules the shared
// page-world core (`agentCore.src.js`) resolves roles with. Split out for size;
// concatenated after the core by `agentCore.ts`, so every function here is in
// scope for the core's `__vmarkRole` (function declarations hoist within the one
// script). Same discipline as the core: self-contained ES5, top-level function
// declarations only, safe on any hostile page.

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
  var attrs = ["aria-label", "aria-labelledby", "aria-describedby", "aria-live", "aria-owns", "aria-controls"];
  for (var i = 0; i < attrs.length; i++) if (el.hasAttribute(attrs[i])) return true;
  return false;
}
