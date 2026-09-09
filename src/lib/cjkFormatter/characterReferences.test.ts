/**
 * HTML character references survive CJK formatting (issue #1382).
 *
 * A character reference is punctuation-wrapped text — `&`, digits or letters,
 * then `;` — so `normalizeFullwidthPunctuation` saw its terminating semicolon
 * as ordinary ASCII punctuation next to CJK and widened it. `&#x5176;实`
 * became `&#x5176；实`, which is no longer a reference: it parses as literal
 * text and is backslash-escaped on the next save. The document silently says
 * something different from what the user wrote.
 *
 * The WYSIWYG serializer EMITS these on its own at a strong/emphasis delimiter
 * boundary, so this was reachable without the user ever typing an entity:
 * bolding `满足自己的需求。` and leaving `其实` outside produces
 * `**满足自己的需求。**&#x5176;实`, and the next Format CJK File corrupted it.
 *
 * Two independent nets are asserted here, because the formatter's own history
 * is that a single one gets bypassed by the next unanticipated rule:
 *
 *   1. references are PROTECTED REGIONS, so no rule can rewrite one;
 *   2. `verifyIntegrity` REFUSES a run that changed the set of references, so
 *      a future rule that reaches one anyway is discarded rather than saved.
 *
 * @coordinates-with markdownParser.ts — the character_reference detector
 * @coordinates-with integrity.ts — referenceInventory and its check
 * @module lib/cjkFormatter/characterReferences.test
 */

import { describe, it, expect } from "vitest";
import { findProtectedRegions } from "./markdownParser";
import { formatMarkdown, formatMarkdownChecked } from "./formatter";
import { verifyIntegrity, referenceInventory } from "./integrity";
import { DEFAULT_CJK_FORMATTING } from "./types";

/** The formatter with the setting that caused the corruption switched ON. */
const format = (text: string) =>
  formatMarkdown(text, { ...DEFAULT_CJK_FORMATTING, fullwidthPunctuation: true });

describe("character references are protected regions", () => {
  it.each([
    ["hexadecimal", "&#x5176;实"],
    ["hexadecimal, uppercase X", "&#X5176;实"],
    ["decimal", "&#20854;实"],
    ["named", "&copy;中文"],
    ["named, digits in the name", "&frac12;中文"],
  ])("%s", (_label, text) => {
    const regions = findProtectedRegions(text);
    const ref = regions.find((r) => r.type === "character_reference");
    if (!ref) throw new Error(`no character_reference region in ${text}`);
    // The region must cover the terminating `;` — that is the character the
    // width rule was rewriting, so a region stopping one short fixes nothing.
    expect(text.slice(ref.start, ref.end)).toMatch(/;$/);
    expect(ref.start).toBe(0);
  });

  it("does not claim an ampersand that terminates nothing", () => {
    // `&` and `;` both present but not a reference: leaving this unprotected is
    // the deliberate trade — over-protection would silently stop legitimate
    // width normalisation in ordinary prose.
    const regions = findProtectedRegions("A & B 中文；然后");
    expect(regions.filter((r) => r.type === "character_reference")).toEqual([]);
  });

  it("does not claim a bare ampersand run", () => {
    expect(
      findProtectedRegions("Q&A 中文").filter((r) => r.type === "character_reference"),
    ).toEqual([]);
  });
});

describe("formatting preserves the reference, with fullwidthPunctuation on", () => {
  // The two cases from the issue, produced by the serializer rather than typed.
  it.each([
    ["serializer-emitted, 其", "**满足自己的需求。**&#x5176;实"],
    ["serializer-emitted, 一", "**我建议你尽快进入做给别人用的东西。**&#x4E00;旦"],
    ["user-authored hexadecimal", "&#x5176;实"],
    ["user-authored decimal", "&#20854;实"],
    ["user-authored named", "&copy;中文"],
  ])("%s", (_label, input) => {
    const { text, refused } = formatMarkdownChecked(input, {
      ...DEFAULT_CJK_FORMATTING,
      fullwidthPunctuation: true,
    });
    expect(text).toContain(input.match(/&[^;]+;/)![0]);
    expect(text).not.toMatch(/&[^;\s]*；/);
    // The load-bearing half. `formatMarkdown` returns the ORIGINAL text when
    // the integrity check refuses, so "the reference survived" is equally what
    // a formatter that gave up entirely would produce. This asserts the
    // PROTECTION did the work and the safety net never fired — otherwise the
    // fix would be "documents containing an entity are no longer formatted".
    expect(refused).toBe(false);
  });

  it("still normalises punctuation OUTSIDE the reference", () => {
    // The protection must be a scalpel: the reference is untouched while the
    // ASCII comma in the surrounding CJK prose is still widened, or this fix
    // would have quietly disabled the feature near any entity.
    const text = format("&copy;中文,后面");
    expect(text).toContain("&copy;");
    expect(text).toContain("，");
  });
});

describe("verifyIntegrity refuses a run that changed a reference", () => {
  it("catches the exact corruption, which the skeleton cannot see", () => {
    const before = "&#x5176;实";
    const corrupted = "&#x5176；实";
    // Proof the second net is needed: NFKC folds `；` back to `;` and both are
    // then stripped as punctuation, so the skeleton is byte-identical.
    expect(verifyIntegrity(before, corrupted).ok).toBe(false);
  });

  it("catches a reference that was dropped entirely", () => {
    expect(verifyIntegrity("a &copy; b", "a  b").ok).toBe(false);
  });

  it("passes an unchanged reference", () => {
    expect(verifyIntegrity("&copy;中文,x", "&copy;中文，x").ok).toBe(true);
  });

  it("inventories every form, in order", () => {
    expect(referenceInventory("&#x5176;a&#20854;b&copy;")).toEqual([
      "&#x5176;",
      "&#20854;",
      "&copy;",
    ]);
  });
});
