/**
 * ARIA role inference — the TypeScript mirror of `agentCore.src.js`'s
 * `__vmarkRole` / `__vmarkIsLandmark` (WI-2.2, audit 2026-09-03 S-02).
 *
 * Split out of `aria.ts` so the accessible-name module can ask "is this role a
 * landmark?" (landmarks never take a name from content) without an import cycle.
 * The mirror cannot execute the core (no 'unsafe-eval' in VMark's webview CSP), so
 * `ariaParity.test.ts` holds both to the same answers over a widened fixture.
 *
 * @coordinates-with lib/browser/agent/agentCore.src.js — the injected original
 * @coordinates-with lib/browser/agent/ariaName.ts — asks `isLandmarkRole`
 * @module lib/browser/agent/ariaRole
 */

export const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Roles that explicitly REMOVE semantics — such an element is not a node. */
const PRESENTATIONAL: ReadonlySet<string> = new Set(["presentation", "none"]);

/** The role vocabulary the resolver recognizes — MUST match `__vmarkKnownRoles`
 *  in agentCore.src.js (pinned by ariaParity.test.ts). An explicit `role` token
 *  outside it is ignored rather than exposed as a nonexistent role. */
export const KNOWN_ROLES: ReadonlySet<string> = new Set(["alert","alertdialog","application","article","banner","button","cell","checkbox","columnheader","combobox","complementary","contentinfo","definition","dialog","directory","document","feed","figure","form","grid","gridcell","group","heading","img","link","list","listbox","listitem","log","main","marquee","math","menu","menubar","menuitem","menuitemcheckbox","menuitemradio","navigation","none","note","option","presentation","progressbar","radio","radiogroup","region","row","rowgroup","rowheader","scrollbar","search","searchbox","separator","slider","spinbutton","status","switch","tab","table","tablist","tabpanel","term","textbox","timer","toolbar","tooltip","tree","treegrid","treeitem"]);

/** The element that OWNS a contenteditable region: `contenteditable` set on itself
 *  (any value but "false"), not inherited from an ancestor. */
function editingHost(el: Element): boolean {
  if (!el.hasAttribute("contenteditable")) return false;
  return (el.getAttribute("contenteditable") ?? "").toLowerCase() !== "false";
}

/** A presentational role is ignored when the element is focusable OR carries a
 *  global ARIA property (ARIA §5.3 conflict resolution). */
function presentationalConflict(el: Element): boolean {
  return focusable(el) || GLOBAL_ARIA.some((attr) => el.hasAttribute(attr));
}
/** Every global WAI-ARIA state and property (ARIA 1.2 §6.4) — any one of them on a
 *  `role="none"/"presentation"` element makes the presentational role a conflict
 *  the implicit role wins. Mirrored in agentCoreRoles.src.js. */
export const GLOBAL_ARIA = ["aria-atomic", "aria-busy", "aria-controls", "aria-current", "aria-describedby", "aria-description", "aria-details", "aria-disabled", "aria-dropeffect", "aria-errormessage", "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label", "aria-labelledby", "aria-live", "aria-owns", "aria-relevant", "aria-roledescription"];

/** Natively focusable, or made focusable by the author (ARIA §5.3 conflict rule). */
function focusable(el: Element): boolean {
  if (el.hasAttribute("tabindex")) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "select" || tag === "textarea" || tag === "summary") return true;
  if (tag === "input") return (el.getAttribute("type") ?? "text").toLowerCase() !== "hidden";
  if (tag === "a") return el.hasAttribute("href");
  return editingHost(el);
}

/**
 * Implicit role per `<input type>`. Types absent from this map keep the textbox
 * fallback: strict ARIA exposes no role for `color`/`file`/`date`, but an agent
 * still has to be able to target them — a file input is perceived (and refused as
 * an upload, never filled), and a `null` role would make it invisible. `hidden` is
 * the one type that genuinely has no role.
 */
const INPUT_ROLES: Record<string, string | null> = {
  checkbox: "checkbox",
  radio: "radio",
  submit: "button",
  button: "button",
  reset: "button",
  image: "button",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  hidden: null,
};

/** Landmark roles — named from label/labelledby/title only (accname §4.3). */
const LANDMARKS: ReadonlySet<string> = new Set([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "form",
  "search",
]);

/** Infer the ARIA role of an element, or null when it has no meaningful role. */
export function computeRole(el: Element): string | null {
  const explicit = el.getAttribute("role")?.trim().toLowerCase();
  if (explicit) {
    // `role` is a token list — the first RECOGNIZED token wins (`role="button link"`);
    // `role="bogus button"` is a button, not the nonexistent role "bogus".
    for (const token of explicit.split(/\s+/)) {
      if (!KNOWN_ROLES.has(token)) continue;
      if (PRESENTATIONAL.has(token)) {
        // Presentational-role conflict resolution: a focusable element, or one
        // carrying a global ARIA property, keeps its implicit semantics.
        if (presentationalConflict(el)) break;
        return null;
      }
      return token;
    }
  }

  const tag = el.tagName.toLowerCase();
  // An editable HOST with no explicit role is the agent's typing target. The
  // attribute, not `isContentEditable`: that property is inherited, so every
  // descendant of an editor would have become its own textbox.
  if (editingHost(el) && tag !== "input" && tag !== "textarea" && tag !== "select") return "textbox";
  // `hasOwn`, not `in`/index: `constructor` or `toString` as a tag or type must not
  // resolve an inherited property into a role.
  if (Object.hasOwn(HEADING_TAGS, tag)) return "heading";
  switch (tag) {
    case "button":
    case "summary": // a disclosure control the agent must be able to target
      return "button";
    case "a":
      return el.hasAttribute("href") ? "link" : null;
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "textarea":
      return "textbox";
    case "select":
      // A multiple/sized select is a listbox, not a combobox.
      return el.hasAttribute("multiple") || Number(el.getAttribute("size") ?? "1") > 1
        ? "listbox"
        : "combobox";
    case "img":
      return "img";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      return Object.hasOwn(INPUT_ROLES, type) ? INPUT_ROLES[type] : "textbox";
    }
    default:
      return null;
  }
}

export function isLandmarkRole(role: string | null): boolean {
  return role !== null && LANDMARKS.has(role);
}
