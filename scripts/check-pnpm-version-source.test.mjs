/**
 * The pnpm version has exactly ONE source of truth, and CI must not contradict it.
 *
 * `pnpm/action-setup` resolves its version like this (read from the pinned
 * bundle at `0ebf471…`, not from the docs):
 *
 *     if (versionInput) {
 *       if (fromPackageManager && fromPackageManager !== versionInput)
 *         throw new Error("Multiple versions of pnpm specified: …")
 *       return versionInput
 *     }
 *     if (devEngines?.packageManager?.version) return it
 *     if (fromPackageManager) return it
 *     throw new Error("No pnpm version is specified.")
 *
 * Two failure modes fall out of that, and this repo had one of each:
 *
 *  - **Both specified, and unequal → every job dies at setup.** The comparison
 *    is exact string equality, so `version: 10` beside
 *    `packageManager: "pnpm@10.33.0"` throws — `"10.33.0" !== "10"`. That is
 *    why adding `packageManager` required removing the `version:` inputs in the
 *    same change rather than after it.
 *  - **Neither specified → that job dies too.** `soak.yml` passes no `version`
 *    and, before `packageManager` existed, nothing else either. It had never
 *    run — a scheduled workflow with zero runs looks exactly like a passing
 *    one, so nothing said so.
 *
 * @coordinates-with package.json — `packageManager`, the single source
 * @coordinates-with .github/actions/setup-node-pnpm/action.yml
 * @module scripts/check-pnpm-version-source.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

/** Every workflow and composite action file, as raw text. */
function actionFiles() {
  const out = [];
  const wf = path.join(REPO, ".github/workflows");
  for (const f of readdirSync(wf)) {
    if (f.endsWith(".yml") || f.endsWith(".yaml")) {
      out.push([`\.github/workflows/${f}`, readFileSync(path.join(wf, f), "utf8")]);
    }
  }
  const actions = path.join(REPO, ".github/actions");
  for (const d of readdirSync(actions, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(actions, d.name, "action.yml");
    try {
      out.push([`.github/actions/${d.name}/action.yml`, readFileSync(p, "utf8")]);
    } catch {
      /* no action.yml in this dir */
    }
  }
  return out;
}

describe("pnpm version has one source of truth", () => {
  it("package.json pins an EXACT pnpm version in packageManager", () => {
    // Corepack and action-setup both want an exact version; a range here
    // silently means "no version" to the `startsWith("pnpm@")` parse.
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it("engines.pnpm does not contradict the pinned version", () => {
    const major = Number(pkg.packageManager.slice("pnpm@".length).split(".")[0]);
    expect(pkg.engines?.pnpm, "engines.pnpm is missing").toBeDefined();
    // The declared range must admit the pinned major, or install refuses under
    // `engine-strict` while CI happily installs it.
    expect(pkg.engines.pnpm).toContain(`>=${major}`);
  });

  it("no workflow passes a `version:` input to pnpm/action-setup", () => {
    // With `packageManager` set, ANY version input that is not byte-identical
    // to it aborts the job before a single test runs.
    const offenders = [];
    for (const [name, text] of actionFiles()) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("pnpm/action-setup")) return;
        // Look at the step's immediate `with:` block (until the next step).
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (/^\s*-\s/.test(lines[j])) break; // next step
          if (/^\s*version:/.test(lines[j])) offenders.push(`${name}:${j + 1}`);
        }
      });
    }
    expect(
      offenders,
      "these pass `version:` to pnpm/action-setup, which conflicts with " +
        "package.json's `packageManager` and throws at setup",
    ).toEqual([]);
  });

  it("every pnpm/action-setup usage can resolve a version", () => {
    // Given the assertion above, resolution can only come from the manifest —
    // so the manifest must exist and be parseable, which the first test pins.
    // This one guards the inverse of the `soak.yml` case: a workflow that uses
    // the action at all is now covered by `packageManager`.
    const users = actionFiles().filter(([, t]) => t.includes("pnpm/action-setup"));
    expect(users.length, "no workflow uses pnpm/action-setup — did they move?").toBeGreaterThan(0);
    expect(pkg.packageManager).toBeDefined();
  });
});
