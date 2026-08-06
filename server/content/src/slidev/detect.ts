/**
 * Slidev deck detection (Phase 6, WI-6.1) — implements the plan's §3bis
 * detection spec. Avoids false positives on ordinary frontmatter notes.
 *
 * A `.md` is a deck when its headmatter (first YAML block) carries a
 * Slidev-specific signal, or an explicit override, per the rules below.
 *
 * @module slidev/detect
 */

import { parse as parseYaml } from "yaml";

/** Headmatter keys that are unambiguously Slidev. */
const SLIDEV_ONLY_KEYS = ["mdc", "drawings", "transition", "fonts", "colorSchema", "aspectRatio"];
/** Keys that signal a deck only in combination (weak alone). */
const WEAK_KEYS = ["theme", "layout", "background", "class"];

export interface DetectionResult {
  isDeck: boolean;
  reason: string;
}

/** Extract the first `---`-delimited YAML headmatter block, if any. */
export function extractHeadmatter(markdown: string): Record<string, unknown> | null {
  // Headmatter must be at the very start (allow a leading BOM/whitespace line).
  const m = /^﻿?\s*---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(markdown);
  if (!m) return null;
  try {
    const parsed = parseYaml(m[1], { maxAliasCount: 100 }); // grill M8
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Cap detection input so a giant single-file deck can't stall the regex (grill M9). */
const DETECT_WINDOW = 64 * 1024;

/**
 * Count `---` slide separators, excluding the headmatter. Matches Slidev's real
 * separator — a line containing only `---` — with optional surrounding blank
 * lines (grill L7; the previous regex required blank-line padding, stricter
 * than §3bis / Slidev itself).
 */
function countSlideSeparators(markdown: string): number {
  const body = markdown.replace(/^﻿?\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, "");
  const matches = body.match(/\r?\n---[ \t]*\r?\n/g);
  return matches ? matches.length : 0;
}

/** Decide whether a markdown document is a Slidev deck (per §3bis). */
export function detectSlidevDeck(fullMarkdown: string): DetectionResult {
  const markdown =
    fullMarkdown.length > DETECT_WINDOW ? fullMarkdown.slice(0, DETECT_WINDOW) : fullMarkdown;
  const hm = extractHeadmatter(markdown);

  // Explicit override (authoritative).
  if (hm && (hm.format === "slidev" || hm.slidev === true)) {
    return { isDeck: true, reason: "explicit format override" };
  }

  if (hm) {
    const keys = Object.keys(hm);
    const slidevOnly = keys.filter((k) => SLIDEV_ONLY_KEYS.includes(k));
    if (slidevOnly.length > 0) {
      return { isDeck: true, reason: `Slidev-only headmatter key: ${slidevOnly[0]}` };
    }
    const weak = keys.filter((k) => WEAK_KEYS.includes(k));
    // A weak key alone (e.g. a note with `layout:`) is NOT enough; require a
    // second weak key OR slide separators to confirm.
    if (weak.length >= 2) {
      return { isDeck: true, reason: `multiple deck headmatter keys: ${weak.join(", ")}` };
    }
    if (weak.length === 1 && countSlideSeparators(markdown) >= 1) {
      return { isDeck: true, reason: `${weak[0]} + slide separators` };
    }
  }

  return { isDeck: false, reason: "no Slidev signal" };
}
