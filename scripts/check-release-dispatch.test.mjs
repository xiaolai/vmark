/**
 * Release workflows must actually START the workflows they depend on.
 *
 * GitHub does not trigger workflows from events created with `GITHUB_TOKEN` —
 * a deliberate anti-recursion rule. `release.yml` publishes its draft with
 * `gh release edit --draft=false` under that token, so the `release: published`
 * trigger declared in `release-smoke.yml` never fires. The GitHub API reported
 * `total_count: 0` runs for release-smoke over its entire history: the release
 * gate had never executed once (audit 20260906, C2).
 *
 * That failure is silent in the worst way — a gate that never runs looks
 * exactly like a gate that always passes.
 *
 * This asserts the wiring, not the smoke test's content: for each consumer
 * workflow triggered by a token-published release, `release.yml` must contain
 * an explicit `gh workflow run` for it.
 *
 * @coordinates-with .github/workflows/release.yml
 * @coordinates-with .github/workflows/release-smoke.yml
 * @module scripts/check-release-dispatch.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO, ".github/workflows");

const releaseText = readFileSync(path.join(WORKFLOWS, "release.yml"), "utf8");
const release = parseYaml(releaseText);

/** Every `run:` line in release.yml, as one blob. */
const releaseRuns = Object.values(release.jobs)
  .flatMap((job) => job.steps ?? [])
  .map((step) => String(step.run ?? ""))
  .join("\n");

/**
 * Consumers that must be dispatched explicitly, because their own trigger
 * cannot fire from a `GITHUB_TOKEN`-published release.
 */
const TOKEN_BLIND_CONSUMERS = ["release-smoke.yml", "update-homebrew.yml"];

describe("release.yml dispatches its downstream workflows", () => {
  for (const consumer of TOKEN_BLIND_CONSUMERS) {
    it(`explicitly runs ${consumer}`, () => {
      expect(existsSync(path.join(WORKFLOWS, consumer))).toBe(true);
      expect(
        releaseRuns,
        `${consumer} would never run: a GITHUB_TOKEN-published release does not trigger workflows`,
      ).toContain(`gh workflow run ${consumer}`);
    });
  }

  it("passes the published tag to the smoke test, not the default", () => {
    // Defaulting to "the latest release" would smoke-test whichever release
    // happens to be newest when the job starts, which during a release is
    // precisely the thing in flux.
    const smokeStep = Object.values(release.jobs)
      .flatMap((job) => job.steps ?? [])
      .find((step) => String(step.run ?? "").includes("gh workflow run release-smoke.yml"));
    expect(smokeStep).toBeDefined();
    expect(String(smokeStep.run)).toMatch(/-f tag=/);
    expect(smokeStep.env?.VERSION ?? "").toContain("create-release.outputs.version");
  });

  // A dispatch that is allowed to fail silently reintroduces the defect: the
  // smoke test would once again never start, and nothing would say so.
  it("does not swallow a failure to start the smoke test", () => {
    const smokeStep = Object.values(release.jobs)
      .flatMap((job) => job.steps ?? [])
      .find((step) => String(step.run ?? "").includes("gh workflow run release-smoke.yml"));
    expect(smokeStep["continue-on-error"]).toBeFalsy();
  });

  it("keeps release-smoke dispatchable by hand with a tag", () => {
    const smoke = parseYaml(readFileSync(path.join(WORKFLOWS, "release-smoke.yml"), "utf8"));
    // `on` parses as the boolean true under YAML 1.1 in some loaders; the
    // `yaml` package keeps it a string key, but accept either spelling.
    const on = smoke.on ?? smoke[true];
    expect(on.workflow_dispatch).toBeDefined();
    expect(on.workflow_dispatch.inputs).toHaveProperty("tag");
  });
});
