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
    // `role` is a token list — the first token wins (`role="button link"`).
    const first = explicit.split(/\s+/)[0];
    return PRESENTATIONAL.has(first) ? null : first;
  }

  const tag = el.tagName.toLowerCase();
  if (HEADING_TAGS[tag]) return "heading";
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
      return type in INPUT_ROLES ? INPUT_ROLES[type] : "textbox";
    }
    default:
      return null;
  }
}

export function isLandmarkRole(role: string | null): boolean {
  return role !== null && LANDMARKS.has(role);
}
