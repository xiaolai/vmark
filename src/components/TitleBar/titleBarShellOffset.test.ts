// @vitest-environment node
/**
 * titleBarShellOffset — pins the browser-mode title bar's left offset to the
 * shell's PUBLISHED side width, never a restatement of the layout arithmetic.
 *
 * The defect this kills: `left: var(--workspace-rail-width)` was written for
 * the pre-card flush 30px rail (7cdd260c2). The leading-card redesign
 * (89c9d0b1c, v0.9.47) moved the rail inside an 8px inset — the card spans
 * inset + rail + sidebar + inset — and the restated offset was not updated, so
 * the opaque browser-mode strip overpainted the card's top-right corner: a
 * white notch below the traffic lights, chopping the card's 13px arc mid-curve.
 *
 * The fix consumes `--shell-side-width`, which AppShell publishes from the
 * same prop that sizes the aside (see AppShell.test.tsx), so the offset cannot
 * drift from the card again. This file reads the stylesheet at runtime, which
 * the vitest import graph cannot see — run it directly after editing the CSS.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("./title-bar.css", import.meta.url), "utf8");

describe("browser-mode title bar offset", () => {
  it("offsets the opaque strip by the published side width", () => {
    expect(css).toMatch(/left:\s*var\(--shell-side-width,\s*0px\)/);
  });

  it("never restates the offset from the bare rail width", () => {
    // The class, not the instance: ANY read of --workspace-rail-width here is
    // a hand-computed fragment of a sum the shell already publishes whole.
    expect(css).not.toMatch(/var\(--workspace-rail-width/);
  });

  it("keeps the omnibox content's absolute start on the traffic-lights line", () => {
    // Invariant: bar left (--shell-side-width) + this pad = --traffic-lights-zone,
    // clamped at 0 for a leading column wider than the zone. The two rules it
    // replaced encoded the same invariant separately per rail state and could
    // disagree; one formula cannot.
    expect(css).toMatch(
      /padding:\s*0\s+var\(--space-2\)\s+0\s+max\(0px,\s*calc\(var\(--traffic-lights-zone\)\s*-\s*var\(--shell-side-width,\s*0px\)\)\)/
    );
  });
});
