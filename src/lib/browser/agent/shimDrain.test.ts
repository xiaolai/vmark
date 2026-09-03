// S-01 — the drain stamp both host clear scripts (console, recorder) write and
// both page-world shims read. One snippet, so the two halves of the contract
// cannot disagree about the attribute name or the arithmetic.
import { describe, it, expect } from "vitest";
import { DRAIN_ATTR, bumpDrainStamp } from "./shimDrain";

function bump(el: Element): void {
  new Function("e", bumpDrainStamp("e"))(el);
}

describe("bumpDrainStamp", () => {
  it("writes a monotonic counter to data-drain, starting from an absent attribute", () => {
    expect(DRAIN_ATTR).toBe("data-drain");
    const el = document.createElement("script");
    bump(el);
    expect(el.getAttribute(DRAIN_ATTR)).toBe("1");
    bump(el);
    bump(el);
    expect(el.getAttribute(DRAIN_ATTR)).toBe("3");
  });

  it("recovers from a page-forged non-numeric value instead of sticking at NaN", () => {
    const el = document.createElement("script");
    el.setAttribute(DRAIN_ATTR, "forged");
    bump(el);
    expect(el.getAttribute(DRAIN_ATTR)).toBe("1");
    el.setAttribute(DRAIN_ATTR, "Infinity");
    bump(el);
    expect(el.getAttribute(DRAIN_ATTR)).toBe("1");
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
