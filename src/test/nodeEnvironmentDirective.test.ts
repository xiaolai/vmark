// @vitest-environment node
/**
 * Purpose: prove the per-file `@vitest-environment node` docblock is ACTUALLY
 *   being honoured, because the failure mode is silent and green.
 *
 * Most app-tier test files carry that directive (834 of 1,439 when this was
 * written; `grep -rl '^// @vitest-environment node' src | wc -l` is the current
 * answer, and the exact number is not what this guards). Constructing a
 * jsdom document costs ~3.3s of worker time per file — measured as 60% of this
 * suite's total worker time — and every marked file was verified to pass
 * without one. Dropping them to `node` measured 2.1x faster on a 289-file
 * sample (125.6s -> 59.7s).
 *
 * If Vitest ever changes how it reads the docblock — a stricter parser, a
 * different comment position, a renamed directive — every one of those files
 * silently falls back to jsdom. Nothing fails. Nothing warns. The suite just
 * quietly gets slower again, and the only evidence is a wall-clock number
 * nobody is watching. This is the same shape as the `poolOptions` trap
 * documented in `vitest.config.ts`: a config that parses, is ignored, and
 * leaves a green run behind it.
 *
 * So: assert the property directly. This file requests `node`; if it gets one,
 * there is no `document`. A jsdom fallback fails here immediately and names
 * the cause.
 *
 * @coordinates-with vitest.config.ts — `environment: "jsdom"` is the default this opts out of
 * @module test/nodeEnvironmentDirective
 */
import { describe, expect, it } from "vitest";

describe("@vitest-environment node docblock", () => {
  it("is honoured — this file has no DOM", () => {
    expect(
      typeof document,
      "`document` exists in a file that asked for the node environment: the " +
        "docblock is being ignored, so every node-marked file silently " +
        "fell back to jsdom. Check Vitest's docblock handling after the last upgrade.",
    ).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("still has the Node globals those files rely on", () => {
    // The directive must select `node`, not merely fail to select `jsdom`.
    expect(typeof process).toBe("object");
    expect(typeof globalThis.setTimeout).toBe("function");
  });
});
