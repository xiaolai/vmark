import { describe, it, expect } from "vitest";
import {
  parseCustomTags,
  DANGEROUS_TAGS,
  PREVIEW_TAGS_BLOCK_STRICT,
  PREVIEW_TAGS_BLOCK_EXTENDED,
  PREVIEW_TAGS_INLINE_EXTENDED,
  PREVIEW_ATTRS_EXTENDED,
  PREVIEW_ATTRS_STRICT,
} from "./htmlAllowlists";

describe("parseCustomTags", () => {
  it("returns [] for empty / nullish input", () => {
    expect(parseCustomTags("")).toEqual([]);
    expect(parseCustomTags(undefined)).toEqual([]);
    expect(parseCustomTags(null)).toEqual([]);
    expect(parseCustomTags("   ")).toEqual([]);
  });

  it("splits on commas and whitespace, lowercases, and trims", () => {
    expect(parseCustomTags("kbd, samp  var\nwbr")).toEqual(["kbd", "samp", "var", "wbr"]);
    expect(parseCustomTags("KBD,SAMP")).toEqual(["kbd", "samp"]);
  });

  it("de-duplicates", () => {
    expect(parseCustomTags("kbd, kbd, KBD")).toEqual(["kbd"]);
  });

  it("allows hyphenated custom-element names", () => {
    expect(parseCustomTags("my-widget")).toEqual(["my-widget"]);
  });

  it("drops syntactically invalid tag names", () => {
    expect(parseCustomTags("<script>, foo bar!, 1tag, -lead, .x")).toEqual(["foo"]);
  });

  it("drops dangerous tags even if typed explicitly (the footgun guard)", () => {
    expect(parseCustomTags("script, style, iframe, form, object, kbd")).toEqual(["kbd"]);
  });
});

describe("allow-list sets", () => {
  it("extended block set is a strict superset that adds svg/figure/details", () => {
    for (const tag of PREVIEW_TAGS_BLOCK_STRICT) {
      expect(PREVIEW_TAGS_BLOCK_EXTENDED).toContain(tag);
    }
    for (const tag of ["svg", "path", "figure", "figcaption", "details", "summary", "section"]) {
      expect(PREVIEW_TAGS_BLOCK_EXTENDED).toContain(tag);
      expect(PREVIEW_TAGS_BLOCK_STRICT).not.toContain(tag);
    }
  });

  it("extended inline set adds semantic + svg tags", () => {
    for (const tag of ["mark", "kbd", "svg", "path"]) {
      expect(PREVIEW_TAGS_INLINE_EXTENDED).toContain(tag);
    }
  });

  it("extended attrs add svg geometry + table/details attrs", () => {
    for (const attr of ["viewBox", "d", "fill", "colspan", "open", "datetime"]) {
      expect(PREVIEW_ATTRS_EXTENDED).toContain(attr);
    }
    for (const attr of PREVIEW_ATTRS_STRICT) {
      expect(PREVIEW_ATTRS_EXTENDED).toContain(attr);
    }
  });

  it("never lists a dangerous tag in any allow-list", () => {
    const dangerous = new Set(DANGEROUS_TAGS);
    for (const tag of PREVIEW_TAGS_BLOCK_EXTENDED) {
      expect(dangerous.has(tag)).toBe(false);
    }
    for (const tag of PREVIEW_TAGS_INLINE_EXTENDED) {
      expect(dangerous.has(tag)).toBe(false);
    }
  });
});
