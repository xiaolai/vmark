/**
 * Accessible-name computation — the TypeScript mirror of `agentCore.src.js`'s
 * `__vmarkNorm` / `__vmarkNameFull` / `__vmarkName` (WI-2.2, audit 2026-09-03
 * S-02 / S-06 / S-09).
 *
 * A pragmatic subset of the WAI-ARIA accname algorithm: aria-labelledby (each
 * reference's aria-label, else its content, hidden references included, never
 * recursed) → aria-label → landmark title only → img alt → form-control name
 * (labels → image alt → placeholder → button value) → name from content (text
 * nodes, image alt, <br> as a space, hidden descendants and script/style
 * skipped) → title. Every source is normalised the same way: NFC, Unicode
 * FORMAT characters stripped, whitespace collapsed — so a zero-width space or a
 * bidi override can neither split one name into two nor restyle a prompt. The
 * result is capped at `NAME_CAP`, which is also the cap the snapshot shows and a
 * locator matches, so a capped name still targets its element.
 *
 * @coordinates-with lib/browser/agent/agentCore.src.js — the injected original;
 *   `ariaParity.test.ts` asserts the two agree element by element
 * @coordinates-with lib/browser/agent/ariaRole.ts — landmark detection
 * @module lib/browser/agent/ariaName
 */

import { computeRole, isLandmarkRole } from "./ariaRole";

/** Accessible-name cap (S-06). */
export const NAME_CAP = 200;

/** Unicode FORMAT characters a page can hide in a name: zero-width space/joiners
 *  and marks, bidi embeddings/overrides/pop, word joiner and invisible operators,
 *  BOM, soft hyphen (S-09). */
const FORMAT_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;

export function normalize(s: string): string {
  return s.normalize("NFC").replace(FORMAT_CHARS, "").replace(/\s+/g, " ").trim();
}

/** An element's OWN hidden-ness (no ancestor walk) — mirrors `__vmarkSelfHidden`. */
export function selfHidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  const style = (el as Partial<HTMLElement>).style;
  return !!style && (style.display === "none" || style.visibility === "hidden");
}

const SKIPPED_IN_CONTENT: ReadonlySet<string> = new Set(["script", "style", "template", "noscript"]);

/** Text alternative from content. `all` keeps hidden descendants (a labelledby
 *  traversal whose referenced node was itself hidden). */
function contentText(el: Element, all: boolean): string {
  let out = "";
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      out += (c as Text).data;
      continue;
    }
    if (c.nodeType !== 1) continue;
    const child = c as Element;
    const tag = child.tagName.toLowerCase();
    if (SKIPPED_IN_CONTENT.has(tag)) continue;
    if (!all && selfHidden(child)) continue;
    if (tag === "br") {
      out += " ";
      continue;
    }
    if (tag === "img") {
      out += child.getAttribute("alt") ?? "";
      continue;
    }
    out += contentText(child, all);
  }
  return out;
}

interface IdScope {
  getElementById(id: string): Element | null;
}

/** The tree that scopes id references for `el`: its shadow root, else its document. */
function rootOf(el: Element): IdScope | null {
  const root = el.getRootNode() as Node & Partial<IdScope>;
  if (typeof root.getElementById === "function") return root as IdScope;
  return el.ownerDocument;
}

/** Text of the elements referenced by an id-list attribute (aria-labelledby). */
function idListText(el: Element, idList: string): string {
  const root = rootOf(el);
  const parts: string[] = [];
  for (const id of idList.trim().split(/\s+/)) {
    const ref = id && root ? root.getElementById(id) : null;
    if (!ref) continue;
    const label = ref.getAttribute("aria-label");
    parts.push(label?.trim() ? label : contentText(ref, selfHidden(ref)));
  }
  return normalize(parts.join(" "));
}

/** The text of every `<label>` associated with a form control, in document order.
 *  Uses the platform's own `labels` association (both `for=` and wrapping); a
 *  custom control the platform associates nothing with can still be named by a
 *  wrapping <label>. */
function labelFor(el: Element): string {
  const labels = (el as Partial<HTMLInputElement>).labels;
  if (labels && labels.length > 0) {
    return normalize(Array.from(labels, (label) => contentText(label, false)).join(" "));
  }
  const wrapping = el.closest("label");
  return wrapping ? normalize(contentText(wrapping, false)) : "";
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

/** The uncapped accessible name ("" when none is derivable). */
function accessibleNameFull(el: Element): string {
  // aria-labelledby outranks aria-label (WAI-ARIA accname): a non-empty reference
  // wins, and aria-label is the fallback when it names nothing.
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby?.trim()) {
    const text = idListText(el, labelledby);
    if (text) return text;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return normalize(ariaLabel);

  // A landmark's content is the page, not its name (accname §4.3, S-06).
  if (isLandmarkRole(computeRole(el))) return normalize(el.getAttribute("title") ?? "");

  const tag = el.tagName.toLowerCase();
  if (tag === "img") return normalize(el.getAttribute("alt") ?? "");
  if (tag === "input" || tag === "textarea" || tag === "select") return formControlName(el);

  const text = normalize(contentText(el, false));
  return text || normalize(el.getAttribute("title") ?? "");
}

/** The accessible name the snapshot shows and a locator matches — capped. */
export function accessibleName(el: Element): string {
  return accessibleNameFull(el).slice(0, NAME_CAP);
}
