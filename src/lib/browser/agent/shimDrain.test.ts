// S-01 — the drain stamp both host clear scripts (console, recorder) write and
// both page-world shims read. One snippet, so the two halves of the contract
// cannot disagree about the attribute name or the arithmetic.
import { describe, it, expect } from "vitest";
import { DRAIN_ATTR, bumpDrainStamp } from "./shimDrain";

function bump(el: Element): void {
  new Function("e", bumpDrainStamp("e"))(el);
}

describe("bumpDrainStamp", () => {
  it("writes a fresh, distinct nonce to data-drain on every bump", () => {
    // A nonce, not a counter (audit 2026-09-03 round 1): a counter a page could
    // forge, or drive past 2^53 where Number arithmetic stops changing, let a
    // clear re-publish drained entries.
    expect(DRAIN_ATTR).toBe("data-drain");
    const el = document.createElement("script");
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      bump(el);
      const stamp = el.getAttribute(DRAIN_ATTR);
      expect(stamp).toBeTruthy();
      expect(seen.has(stamp as string)).toBe(false);
      seen.add(stamp as string);
    }
  });

  it("replaces whatever the page forged, numeric or not", () => {
    const el = document.createElement("script");
    for (const forged of ["forged", "Infinity", "NaN", String(Number.MAX_SAFE_INTEGER)]) {
      el.setAttribute(DRAIN_ATTR, forged);
      bump(el);
      expect(el.getAttribute(DRAIN_ATTR)).not.toBe(forged);
      expect(el.getAttribute(DRAIN_ATTR)).not.toBe("NaN");
    }
  });

  it("always changes the stamp — the property the shims rely on", () => {
    const el = document.createElement("script");
    for (const forged of ["", "0", "1", "abc", "-5", "2.5"]) {
      el.setAttribute(DRAIN_ATTR, forged);
      bump(el);
      expect(el.getAttribute(DRAIN_ATTR)).not.toBe(forged);
    }
  });
});
