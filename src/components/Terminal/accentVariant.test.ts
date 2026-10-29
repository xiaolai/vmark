// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isAccentVariantOf } from "./accentVariant";

describe("isAccentVariantOf", () => {
  it.each([
    ["u", "ü"],
    ["u", "ú"],
    ["u", "ū"],
    ["e", "é"],
    ["e", "ę"],
    ["c", "ç"],
    ["n", "ñ"],
    ["z", "ż"],
    ["U", "Ü"],
    ["E", "É"],
    ["u", "ǖ"], // two combining marks, base still u
  ])("%s → %s is an accent variant", (base, text) => {
    expect(isAccentVariantOf(base, text)).toBe(true);
  });

  it.each([
    ["a", "æ"],
    ["o", "ø"],
    ["o", "œ"],
    ["s", "ß"],
    ["l", "ł"],
    ["A", "Æ"],
    ["O", "Ø"],
    ["O", "Œ"],
    ["L", "Ł"],
  ])("%s → %s is a press-and-hold variant with no decomposition", (base, text) => {
    expect(isAccentVariantOf(base, text)).toBe(true);
  });

  it.each([
    ["u", "u", "the base itself"],
    ["u", "é", "a variant of another letter"],
    ["a", "ü", "a variant of another letter"],
    ["u", "Ü", "a case change"],
    ["U", "ü", "a case change"],
    ["u", "啊", "CJK text"],
    ["u", "üa", "more than one character"],
    ["u", "", "empty text"],
    ["", "ü", "an empty base"],
    ["uu", "ü", "a multi-character base"],
    ["2", "²", "a compatibility form, not an accent"],
    ["u", "̈", "a bare combining mark"],
  ])("%s → %s is not a variant (%s)", (base, text) => {
    expect(isAccentVariantOf(base, text)).toBe(false);
  });
});
