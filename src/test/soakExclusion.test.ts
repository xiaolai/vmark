// @vitest-environment node
/**
 * WI-5.1 DoD pin — soak files are PROVABLY absent from the default vitest
 * include. `*.soak.test.ts` matched the default `*.test.ts` include until
 * the plan's ADR-6 split; this test fails if the exclusion is ever dropped,
 * which would silently pull runtime-download soaks into `pnpm check:all`.
 *
 * @module test/soakExclusion.test
 */
import { describe, it, expect } from "vitest";
import defaultConfig from "../../vitest.config";
import soakConfig from "../../vitest.soak.config";
import { suffixGlob, testGlob } from "../../vitest.shared";

/**
 * These used to `readFileSync` the config files and assert on their SOURCE
 * TEXT. That passes on a comment mentioning the pattern and fails on a
 * refactor that preserves the behaviour exactly — it pinned the spelling, not
 * the separation. Both now read the resolved config objects.
 */
describe("soak tier separation", () => {
  const SOAK = suffixGlob("src", "soak");

  it("the default config excludes soak files", () => {
    expect(defaultConfig.test?.exclude).toContain(SOAK);
    // And its include would otherwise have collected them — which is what
    // makes the exclusion load-bearing rather than decorative.
    expect(defaultConfig.test?.include).toContain(testGlob("src"));
  });

  it("the soak config includes ONLY soak files", () => {
    expect(soakConfig.test?.include).toEqual([SOAK]);
  });

  it("both tiers agree on the extension set", () => {
    // A soak file with an extension the default include accepts but the
    // exclusion does not would run in `check:all` — a runtime-download soak
    // gating a PR. Sharing one generator is what prevents that.
    expect(SOAK).toContain("{js,mjs,cjs,ts,mts,cts,jsx,tsx}");
  });
});
