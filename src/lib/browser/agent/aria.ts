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
 * Key decisions:
 *   - Hidden elements (and their subtrees) are never perceived or targeted: a
 *     hidden duplicate of a control would otherwise shadow the real one.
 *   - State (checked/disabled) is read from the LIVE DOM (property, `:disabled`),
 *     not from the initial attributes, which never move after user interaction.
 *
 * Known limitations: hiding via a stylesheet rule (rather than `hidden`,
 * `aria-hidden`, `inert`, or an inline style) is not detected — that needs layout,
 * which jsdom does not have; `aria-checked="mixed"` collapses to `false`.
 *
 * @coordinates-with lib/browser/agent/actScript.ts — the injected copy of these
 *   rules; `actScript.test.ts` asserts the two perceive a page identically
 * @module lib/browser/agent/aria
 */

import { refFor } from "./refs";

/** A compact accessibility node for the AI to read. */
export interface AriaNode {
  role: string;
  name: string;
  /** Stable handle for this element within the committed page (WI-P2.1). `act`
   *  can target `{ref}` exactly instead of re-resolving a fuzzy role + name. */
  ref: string;
  /** Heading level (1–6), when `role === "heading"`. */
  level?: number;
  /** Checked state, when `role` is checkbox/radio. */
  checked?: boolean;
  /** Disabled state, when applicable. */
  disabled?: boolean;
}

const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Roles that explicitly REMOVE semantics — such an element is not a node. */
const PRESENTATIONAL: ReadonlySet<string> = new Set(["presentation", "none"]);

/**
 * Implicit role per `<input type>`. Types absent from this map keep the textbox
 * fallback: strict ARIA exposes no role for `color`/`file`/`date`, but an agent
 * still has to be able to target and fill them, and a `null` role would make them
 * invisible. `hidden` is the one type that genuinely has no role.
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

/** The text of every `<label>` associated with a form control, in document order.
 *  Uses the platform's own `labels` association (both `for=` and wrapping) — an
 *  indexed lookup, not a document-wide scan per control. */
function labelFor(el: Element): string {
  const labels = (el as Partial<HTMLInputElement>).labels;
  if (labels && labels.length > 0) {
    return normalize(Array.from(labels, (label) => label.textContent ?? "").join(" "));
  }
  // Custom controls have no `labels`; a wrapping <label> can still name them.
  const wrapping = el.closest("label");
  return wrapping?.textContent ? normalize(wrapping.textContent) : "";
}

/** Name of a form control: label → (image button) alt → placeholder → button value. */
function formControlName(el: Element): string {
  const label = labelFor(el);
  if (label) return label;

  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type === "image") {
    const alt = normalize(el.getAttribute("alt") ?? "");
    if (alt) return alt;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder?.trim()) return normalize(placeholder);

  if (type === "submit" || type === "button" || type === "reset" || type === "image") {
    const value = el.getAttribute("value");
    if (value?.trim()) return normalize(value);
  }
  return "";
}

/** Compute a pragmatic accessible name for an element ("" when none derivable).
 *  Every source is whitespace-normalized, so two spellings of the same name are
 *  the same name for an exact lookup. */
export function accessibleName(el: Element): string {
  // aria-labelledby has HIGHER precedence than aria-label (WAI-ARIA accname): resolve a
  // non-empty labelledby reference first, and only fall back to aria-label when it names
  // nothing. Taking aria-label first would mis-name a control carrying both.
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = idListText(el, labelledby);
    if (text) return text;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return normalize(ariaLabel);

  const tag = el.tagName.toLowerCase();
  if (tag === "img") return normalize(el.getAttribute("alt") ?? "");

  if (tag === "input" || tag === "textarea" || tag === "select") {
    return formControlName(el);
  }

  if (el.textContent?.trim()) return normalize(el.textContent);
  const title = el.getAttribute("title");
  return title ? normalize(title) : "";
}

/**
 * Is `el` (or any ancestor) hidden from the accessibility tree?
 *
 * A hidden element is not perceivable, so it must be neither snapshotted nor
 * targeted — a hidden duplicate of "Publish" would otherwise shadow the visible
 * one and the agent would act on nothing while reporting success.
 */
function isHidden(el: Element): boolean {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert")) return true;
    if (node.getAttribute("aria-hidden") === "true") return true;
    const style = (node as Partial<HTMLElement>).style;
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  }
  return false;
}

function nameMatches(actual: string, wanted: string, exact: boolean): boolean {
  return exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase());
}

/** Find every visible element with the given role, optionally filtered by
 *  accessible name (exact by default; substring when `exact: false`). Document
 *  order. Hidden elements are never returned. */
export function queryByRole(
  root: Element,
  role: string,
  opts: { name?: string; exact?: boolean } = {},
): Element[] {
  const exact = opts.exact !== false;
  return Array.from(root.querySelectorAll("*")).filter(
    (el) =>
      computeRole(el) === role &&
      !isHidden(el) &&
      (opts.name === undefined || nameMatches(accessibleName(el), opts.name, exact)),
  );
}

/** Effective disabled state — including inherited disablement (a control inside a
 *  disabled `<fieldset>`), which no attribute on the element itself records. */
function isDisabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.matches(":disabled")) return true;
  // Custom controls (`<div role="button" disabled>`) that `:disabled` never matches.
  return el.hasAttribute("disabled");
}

/** Checked state from the LIVE property — the `checked` attribute records only the
 *  INITIAL state and never moves when the user clicks. */
function isChecked(el: Element): boolean {
  if (el.tagName === "INPUT") return (el as HTMLInputElement).checked;
  return el.getAttribute("aria-checked") === "true";
}

/** Render the page's interesting, visible elements as a flat list of accessibility
 *  nodes (generic containers with no role, and hidden subtrees, are omitted). */
export function ariaSnapshot(root: Element): AriaNode[] {
  const nodes: AriaNode[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const role = computeRole(el);
    if (!role || isHidden(el)) return;
    const node: AriaNode = { role, name: accessibleName(el), ref: refFor(el) };
    const level = HEADING_TAGS[el.tagName.toLowerCase()];
    if (role === "heading") node.level = level ?? (Number(el.getAttribute("aria-level")) || undefined);
    if (role === "checkbox" || role === "radio") node.checked = isChecked(el);
    if (isDisabled(el)) node.disabled = true;
    nodes.push(node);
  });
  return nodes;
}
