// @vitest-environment node
/**
 * Cosmetic-pass invariants.
 *
 * Two properties this suite exists to pin:
 *   1. The size ceiling is DOCUMENTED, TESTED behaviour on both sides. It
 *      exists because verification re-parses the document (~22 s at 5 MB);
 *      the cost of keeping it is untidier — but still correct and still
 *      stable — output above the line.
 *   2. The block-start guard is DERIVED from the characters the pass can
 *      actually emit, so it cannot drift into listing branches nothing reaches.
 */
import { describe, it, expect } from "vitest";
import {
  applyCosmeticPass,
  BLOCK_START_GUARD,
  COSMETIC_VERIFY_LIMIT,
  UNESCAPABLE_CHARS,
} from "./serializerCosmetics";

describe("BLOCK_START_GUARD", () => {
  it("contains exactly the block-start characters the pass can emit", () => {
    // `SAFE_UNESCAPE_RE` yields [ ] $ ` _ * ! ( ) : @ — of the block-start
    // set (# - * > +) only `*` intersects.
    expect([...BLOCK_START_GUARD].sort()).toEqual(["*"]);
  });

  it("derives that set by PARSING the regex, not from a second list", () => {
    // The claim "changing the regex extends the guard automatically" is only
    // true if the character set is read from the regex. Pin the parse so a
    // silently-narrowed guard fails here.
    expect([...UNESCAPABLE_CHARS].sort().join("")).toBe("!$()*:@[]_`");
  });
});

describe("the cosmetic-pass size ceiling is documented behaviour", () => {
  /** Cleanly unescapable: a lone `\$` reparses identically without it. */
  const unit = "Costs \\$5 here.\n\n";

  it("cleans up a document below the ceiling", () => {
    expect(applyCosmeticPass(unit)).toContain("$5 here");
    expect(applyCosmeticPass(unit)).not.toContain("\\$5");
  });

  it("refuses an edit that would change meaning", () => {
    // TWO dollar signs would reparse as inline MATH, so the same `\$` that
    // is safe to unescape above must stay escaped here. That distinction is
    // exactly what verification buys over a per-character guess, and the
    // pass is all-or-nothing per document.
    expect(applyCosmeticPass("Costs \\$5 and \\$10.\n\n")).toContain("\\$5");
  });

  it("keeps the conservative form above the ceiling", () => {
    // Verification re-parses the whole document; at 5 MB that costs ~22 s,
    // so above the ceiling the conservative output is kept deliberately.
    const big = unit.repeat(Math.ceil((COSMETIC_VERIFY_LIMIT + 1) / unit.length));
    expect(big.length).toBeGreaterThan(COSMETIC_VERIFY_LIMIT);
    expect(applyCosmeticPass(big)).toBe(big);
  });

  it("is a fixed point on BOTH sides of the ceiling", () => {
    // The safety property that actually matters: conservative output is
    // still correct, stable markdown — just less tidy.
    const small = applyCosmeticPass(unit.repeat(10));
    expect(applyCosmeticPass(small)).toBe(small);
    const big = unit.repeat(Math.ceil((COSMETIC_VERIFY_LIMIT + 1) / unit.length));
    expect(applyCosmeticPass(applyCosmeticPass(big))).toBe(applyCosmeticPass(big));
  });

  it("keeps a line-leading escaped asterisk escaped below the ceiling", () => {
    // The guard case: unescaping here would create a list item.
    expect(applyCosmeticPass("\\* not a list item\n\n")).toContain("\\*");
  });
});
