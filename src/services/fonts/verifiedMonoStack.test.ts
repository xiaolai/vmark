// @vitest-environment node
/**
 * verifiedMonoStack — the drop-the-head algorithm (#1334).
 *
 * The measurement is INJECTED here rather than taken from a real engine. The
 * previous guard for this bug measured real fonts, which meant it silently
 * asserted nothing on any machine without a CJK locale — it passed on macOS and
 * on CI while the bug was live. Driving the algorithm directly is the half that
 * can always fail; `verifiedMonoStack.webkit.test.ts` covers the real engine.
 */
import { describe, it, expect, vi } from "vitest";
import { narrowToMonospace, resetMonoStackCache, verifiedMonoStack } from "./verifiedMonoStack";

/** A fake engine where only the named families render monospace. */
function engineWith(monospaceFamilies: string[]) {
  return (candidate: string) => {
    const head = candidate.split(",")[0].trim();
    return monospaceFamilies.includes(head);
  };
}

describe("narrowToMonospace", () => {
  it("keeps the stack untouched when the head already renders monospace", () => {
    const stack = '"JetBrains Mono", monospace';
    expect(narrowToMonospace(stack, engineWith(['"JetBrains Mono"']))).toBe(stack);
  });

  // The reported case: the user's chosen family is not installed, and under a
  // CJK locale fontconfig answers with a proportional face instead of letting
  // the cascade reach the generic behind it.
  it("drops a head family that does not render monospace", () => {
    expect(
      narrowToMonospace('"JetBrains Mono", monospace', engineWith(["monospace"])),
    ).toBe("monospace");
  });

  it("drops families one at a time, keeping the first that works", () => {
    expect(
      narrowToMonospace(
        'Consolas, "Courier New", monospace',
        engineWith(['"Courier New"']),
      ),
    ).toBe('"Courier New", monospace');
  });

  it("falls back to the last family when nothing measures monospace", () => {
    // No better answer exists — the generic is the engine's own fixed-pitch
    // font. Returning the original stack instead would keep the broken head.
    expect(narrowToMonospace('"A", "B", monospace', engineWith([]))).toBe("monospace");
  });

  it("returns the input unchanged when it is empty", () => {
    expect(narrowToMonospace("", engineWith([]))).toBe("");
  });

  it("tolerates stray whitespace and empty entries", () => {
    expect(
      narrowToMonospace('  "A" ,  , monospace ', engineWith(["monospace"])),
    ).toBe("monospace");
  });

  it("never returns a stack the engine rejected", () => {
    // Guards the loop bound: an off-by-one that returned families[i-1] would
    // hand back the very family that failed.
    const engine = engineWith(["monospace"]);
    const result = narrowToMonospace('"X", "Y", "Z", monospace', engine);
    expect(engine(result)).toBe(true);
  });

  it("stops at the FIRST family that works, not the last", () => {
    expect(
      narrowToMonospace('"A", "B", monospace', engineWith(['"B"', "monospace"])),
    ).toBe('"B", monospace');
  });
});

describe("verifiedMonoStack", () => {
  it("memoizes per preferred stack", () => {
    resetMonoStackCache();
    // Without a DOM every candidate reports monospace, so this asserts the
    // caching path rather than the measurement.
    const first = verifiedMonoStack("jetbrains", "linux");
    const second = verifiedMonoStack("jetbrains", "linux");
    expect(second).toBe(first);
  });

  it("emits no ui-* generic on linux", () => {
    resetMonoStackCache();
    expect(verifiedMonoStack("system", "linux")).not.toMatch(/\bui-[a-z]+\b/);
  });

  it("returns the preferred stack unmeasured when there is no DOM", () => {
    // Node environment: nothing to measure. Downgrading on a guess would strip
    // the user's font for no reason.
    resetMonoStackCache();
    expect(verifiedMonoStack("jetbrains", "linux")).toContain("JetBrains Mono");
  });
});

describe("stackRendersMonospace without a DOM", () => {
  it("reports true rather than downgrading blind", async () => {
    const { stackRendersMonospace } = await import("./verifiedMonoStack");
    expect(stackRendersMonospace('"Anything At All"')).toBe(true);
  });

  it("does not touch the document when there is none", () => {
    // Regression guard: an unguarded document.createElement here would throw in
    // the node tier, which is where most of this repo's suite runs.
    expect(() => verifiedMonoStack("system", "macos")).not.toThrow();
    expect(vi.isMockFunction(globalThis.document)).toBe(false);
  });
});
