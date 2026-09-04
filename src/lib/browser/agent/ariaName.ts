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
 * The name-from-content walk is bounded the same way on both sides (#105): an
 * iterative cursor over each open node's live child list (never a copied list,
 * never recursion — a page a billion wide or a hundred thousand deep costs a
 * cursor per open node), gathering text a window of `CONTENT_BUDGET` characters at
 * a time with whitespace collapsed and format characters stripped as it goes, so
 * a text node holding megabytes is never copied and a flood of bidi controls or
 * spaces never spends the budget. `__vmarkContentBudget()` in the core returns
 * the same number; `ariaParity.test.ts` pins the two equal.
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
/** Every Unicode FORMAT character (general category Cf) — bidi controls and
 *  isolates, zero-width joiners/spaces, soft hyphen, the Arabic/Syriac/Mongolian
 *  marks (U+0600–0605, U+06DD, U+070F, U+0890–0891, U+08E2, U+180E), interlinear
 *  annotation marks and the deprecated tags block. A property escape, so no hand
 *  list can lag the standard; both sides use it (WebKit ≥ 11.1 supports `\p{}`). */
const FORMAT_CHARS = /\p{Cf}/gu;

/** Collapsed characters the content walk gathers before it stops: many times the
 *  name cap, so a whitespace-heavy name still fills it, but a hostile page's
 *  megabyte of text never becomes one string. Mirrors `__vmarkContentBudget()`. */
export const CONTENT_BUDGET = NAME_CAP * 16;

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

/** Append `text` to `out` up to `budget` characters, whitespace collapsed and
 *  format characters stripped AS GATHERED — so neither a run of spaces (3,200
 *  leading spaces used to erase a valid name) nor a flood of bidi controls can
 *  spend the budget. The raw text is consumed a window of `budget` characters at
 *  a time: a text node holding megabytes costs one window per pass, never a
 *  stripped copy of the whole, and a window that strips to nothing is followed by
 *  the next, so the visible text after it still names. (A format character split
 *  across two windows survives this pass at a cost of two budget units; every
 *  caller's final `normalize` removes it.) Mirrors `__vmarkTake`. */
function take(out: string, text: string, budget: number): string {
  for (let off = 0; off < text.length && out.length < budget; off += budget) {
    let piece = text.slice(off, off + budget).replace(FORMAT_CHARS, "").replace(/\s+/g, " ");
    if (piece.startsWith(" ") && (out === "" || out.endsWith(" "))) piece = piece.slice(1);
    out += piece.slice(0, budget - out.length);
  }
  return out;
}

/** A cursor over one open node's live child list — children are read by index,
 *  so a node a billion wide costs this object, not a copied list. */
interface ChildCursor {
  kids: NodeListOf<ChildNode>;
  i: number;
}

/** Text alternative from content. `all` keeps hidden descendants (a labelledby
 *  traversal whose referenced node was itself hidden). Mirrors `__vmarkContentText`. */
function contentText(el: Element, all: boolean): string {
  // Iterative cursor walk with a budget: the recursive version built the entire
  // descendant text before the cap applied, so a deep or enormous subtree could
  // overflow the stack or allocate without bound before anything was capped; the
  // stack is bounded by depth and nothing is pushed before the budget is checked.
  let out = "";
  const stack: ChildCursor[] = [{ kids: el.childNodes, i: 0 }];
  while (stack.length > 0 && out.length < CONTENT_BUDGET) {
    const top = stack[stack.length - 1];
    if (top.i >= top.kids.length) {
      stack.pop();
      continue;
    }
    const node = top.kids[top.i];
    top.i += 1;
    if (node.nodeType === 3) {
      out = take(out, (node as Text).data, CONTENT_BUDGET);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (SKIPPED_IN_CONTENT.has(tag)) continue;
    if (!all && selfHidden(child)) continue;
    if (tag === "br") {
      out = take(out, " ", CONTENT_BUDGET);
      continue;
    }
    if (tag === "img") {
      out = take(out, child.getAttribute("alt") ?? "", CONTENT_BUDGET);
      continue;
    }
    stack.push({ kids: child.childNodes, i: 0 });
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
  if (tag === "input" || tag === "textarea" || tag === "select") {
    // A control named only by its title still gets a locator name (accname §4.3.1
    // step 2I applies to controls too); it used to come back empty.
    return formControlName(el) || normalize(el.getAttribute("title") ?? "");
  }

  const text = normalize(contentText(el, false));
  return text || normalize(el.getAttribute("title") ?? "");
}

/** The accessible name the snapshot shows and a locator matches — capped. */
export function accessibleName(el: Element): string {
  return accessibleNameFull(el).slice(0, NAME_CAP);
}
