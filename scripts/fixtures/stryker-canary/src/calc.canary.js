// Canary fixture test — named *.canary.js so the ROOT vitest suite never
// collects it; only the fixture's own vitest.config.js includes it (it runs
// inside Stryker's sandbox during the break-threshold canary meta-test).
// It covers `add` fully and `isEven` not at all — by design; see ./calc.js.
import { expect, it } from "vitest";
import { add } from "./calc.js";

it("adds two numbers", () => {
  expect(add(2, 3)).toBe(5);
});
