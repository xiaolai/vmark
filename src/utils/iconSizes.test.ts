// WI-UI2.3 — the sanctioned lucide glyph sizes (C7). One module states the
// vocabulary; the gate (check-ui-consistency C7) enforces it.
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ICON_SIZES, ICON_XS, ICON_SM, ICON_MD, ICON_LG } from "./iconSizes";

describe("iconSizes", () => {
  it("the vocabulary is exactly {12, 14, 16, 18}", () => {
    expect([...ICON_SIZES].sort((a, b) => a - b)).toEqual([12, 14, 16, 18]);
  });

  it("each named size is in the vocabulary", () => {
    for (const s of [ICON_XS, ICON_SM, ICON_MD, ICON_LG]) {
      expect(ICON_SIZES.has(s)).toBe(true);
    }
  });
});
