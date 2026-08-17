/**
 * `actions/setup-node` with `cache:` set is a CLAIM that the job installs.
 *
 * The cache is saved in a POST step, after every real step has already run. If
 * the job never populates the store, that post step fails with "Path Validation
 * Error: Path(s) specified in the action for caching do(es) not exist" and takes
 * the whole job red — after its work succeeded. Anything gated on `needs:` that
 * job is then SKIPPED, so the visible symptom is not "cache broken" but "the
 * report stopped being filed".
 *
 * `baseline-review.yml` shipped that way and its weekly issue silently stopped
 * (2026-08-17): `measure` computed the full debt table, set every output, and
 * died in cleanup; `report` never ran. Five other workflows request the same
 * cache and all install, so this is a one-off — which is exactly when to pin it,
 * before it becomes a class.
 *
 * Discovers workflows rather than listing them, so a new one is covered on
 * creation.
 *
 * @coordinates-with .github/workflows/*.yml
 * @module scripts/check-workflow-node-cache.test
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, ".github/workflows");

const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => ({ name: f, doc: parse(readFileSync(path.join(DIR, f), "utf8")) }));

/** Every step of every job, flattened, with its job name. */
function steps(doc) {
  return Object.entries(doc?.jobs ?? {}).flatMap(([job, def]) =>
    (def?.steps ?? []).map((step) => ({ job, step })),
  );
}

/** Does this step populate a package-manager store? */
function installs(step) {
  const run = typeof step.run === "string" ? step.run : "";
  // `pnpm/action-setup` can install by itself via `run_install`.
  const usesInstall =
    typeof step.uses === "string" &&
    step.uses.includes("pnpm/action-setup") &&
    step.with?.run_install !== undefined &&
    step.with?.run_install !== false;
  return usesInstall || /\b(pnpm|npm|yarn)\s+(install|ci|i)\b/.test(run);
}

describe("setup-node cache claims", () => {
  it("finds the workflows (guards against a silently empty sweep)", () => {
    expect(workflows.length).toBeGreaterThan(5);
  });

  it("is only requested by jobs that actually install", () => {
    const offenders = [];
    for (const { name, doc } of workflows) {
      const byJob = new Map();
      for (const { job, step } of steps(doc)) {
        const entry = byJob.get(job) ?? { cached: false, installs: false };
        if (
          typeof step.uses === "string" &&
          step.uses.includes("actions/setup-node") &&
          step.with?.cache
        ) {
          entry.cached = true;
        }
        if (installs(step)) entry.installs = true;
        byJob.set(job, entry);
      }
      for (const [job, entry] of byJob) {
        if (entry.cached && !entry.installs) offenders.push(`${name}:${job}`);
      }
    }
    // A job caching a store it never writes fails in its POST step, after
    // succeeding — and skips everything downstream of it.
    expect(offenders).toEqual([]);
  });
});
