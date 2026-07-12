/**
 * Agent perception — ARIA role inference, accessible names, page snapshot, and
 * role/name locators (WI-2.2).
 *
 * Purpose: how the AI *sees* and *targets* a page. `ariaSnapshot` renders the
 * interactive/structural elements as compact `{role, name, …}` nodes the model
 * reads; `queryByRole` resolves a role+accessible-name locator back to elements
 * to act on. Role+name targeting is preferred over CSS/XPath because it is
 * self-describing and resilient to markup churn (the Playwright/ARIA approach).
 *
 * Leaf-pure DOM logic — no store, no Tauri — so it is jsdom-unit-testable and
 * can also be injected verbatim into the page's isolated world by the driver.
 * This is a pragmatic subset of the ARIA accname algorithm, not a full
 * implementation; the interaction tiers (WI-2.3) consume the resolved elements.
 *
 * @module lib/browser/agent/aria
 */

/** A compact accessibility node for the AI to read. */
export interface AriaNode {
  role: string;
  name: string;
  /** Heading level (1–6), when `role === "heading"`. */
  level?: number;
  /** Checked state, when `role` is checkbox/radio. */
  checked?: boolean;
  /** Disabled state, when applicable. */
  disabled?: boolean;
}

const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const INPUT_ROLES: Record<string, string | null> = {
  checkbox: "checkbox",
  radio: "radio",
  submit: "button",
  button: "button",
  reset: "button",
  image: "button",
  range: "slider",
  hidden: null,
};

/** Infer the ARIA role of an element, or null when it has no meaningful role. */
export function computeRole(el: Element): string | null {
  const explicit = el.getAttribute("role")?.trim().toLowerCase();
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  if (HEADING_TAGS[tag]) return "heading";
  switch (tag) {
    case "button":
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
      return "combobox";
    case "img":
      return "img";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      // Known non-text types map explicitly; everything else is a textbox.
      return type in INPUT_ROLES ? INPUT_ROLES[type] : "textbox";
    }
    default:
      return null;
  }
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Text of the elements referenced by an id-list attribute (aria-labelledby). */
function idListText(el: Element, idList: string): string {
  const doc = el.ownerDocument;
  return normalize(
    idList
      .split(/\s+/)
      .map((id) => doc?.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

/** The `<label>` associated with a form control (via `for` or wrapping). */
function labelFor(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = Array.from(el.ownerDocument?.querySelectorAll("label[for]") ?? []).find(
      (l) => l.getAttribute("for") === id,
    );
    if (label?.textContent?.trim()) return normalize(label.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) return normalize(wrapping.textContent);
  return "";
}

/** Compute a pragmatic accessible name for an element ("" when none derivable). */
export function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = idListText(el, labelledby);
    if (text) return text;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "img") return normalize(el.getAttribute("alt") ?? "");

  if (tag === "input" || tag === "textarea" || tag === "select") {
    const label = labelFor(el);
    if (label) return label;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder?.trim()) return placeholder.trim();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const value = el.getAttribute("value");
      if (value?.trim()) return value.trim();
    }
    return "";
  }

  if (el.textContent?.trim()) return normalize(el.textContent);
  return el.getAttribute("title")?.trim() ?? "";
}

function nameMatches(actual: string, wanted: string, exact: boolean): boolean {
  return exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase());
}

/** Find every element with the given role, optionally filtered by accessible
 *  name (exact by default; substring when `exact: false`). Document order. */
export function queryByRole(
  root: Element,
  role: string,
  opts: { name?: string; exact?: boolean } = {},
): Element[] {
  const exact = opts.exact !== false;
  return Array.from(root.querySelectorAll("*")).filter(
    (el) =>
      computeRole(el) === role &&
      (opts.name === undefined || nameMatches(accessibleName(el), opts.name, exact)),
  );
}

function isDisabled(el: Element): boolean {
  return el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
}

function isChecked(el: Element): boolean {
  return el.hasAttribute("checked") || el.getAttribute("aria-checked") === "true";
}

/** Render the page's interesting elements as a flat list of accessibility nodes
 *  (generic containers with no role are omitted). */
export function ariaSnapshot(root: Element): AriaNode[] {
  const nodes: AriaNode[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const role = computeRole(el);
    if (!role) return;
    const node: AriaNode = { role, name: accessibleName(el) };
    const level = HEADING_TAGS[el.tagName.toLowerCase()];
    if (role === "heading") node.level = level ?? (Number(el.getAttribute("aria-level")) || undefined);
    if (role === "checkbox" || role === "radio") node.checked = isChecked(el);
    if (isDisabled(el)) node.disabled = true;
    nodes.push(node);
  });
  return nodes;
}
