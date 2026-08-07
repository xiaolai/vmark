/**
 * The Rust cache only works if two workflows agree, and it fails SILENTLY when
 * they don't.
 *
 * `ci.yml`'s `rust-test` restores a compiled-artifact cache; `rust-cache-warm.yml`
 * is the only thing that writes one to the default branch, which is the only
 * scope a pull-request run can read. If their `shared-key` or `workspaces` ever
 * drift apart, the warm job still succeeds, every PR still passes, and the only
 * symptom is that Windows quietly goes back to ~22 minutes. Nothing turns red.
 * That is precisely the failure class that needs an assertion rather than a
 * comment.
 *
 * It also pins the property that keeps the warmer legal under
 * `.claude/rules/60-ai-governance.md` §10: the warmer COMPILES and asserts
 * nothing. The moment it runs a test suite it becomes the duplicate
 * verification of byte-identical trees that §10 deleted the `push: [main]` CI
 * trigger to stop.
 *
 * @coordinates-with .github/workflows/ci.yml — rust-test
 * @coordinates-with .github/workflows/rust-cache-warm.yml
 * @module scripts/check-rust-cache-parity.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => parse(readFileSync(path.join(REPO, p), "utf8"));

const ci = read(".github/workflows/ci.yml");
const warm = read(".github/workflows/rust-cache-warm.yml");

/** The `Swatinem/rust-cache` step of a job, or undefined. */
function rustCacheStep(job) {
  return (job?.steps ?? []).find((s) => String(s.uses ?? "").startsWith("Swatinem/rust-cache@"));
}

const ciStep = rustCacheStep(ci.jobs["rust-test"]);
const warmStep = rustCacheStep(warm.jobs.warm);

describe("rust cache: restore side and warm side agree", () => {
  it("both workflows actually use rust-cache", () => {
    expect(ciStep, "ci.yml rust-test has no Swatinem/rust-cache step").toBeDefined();
    expect(warmStep, "rust-cache-warm.yml has no Swatinem/rust-cache step").toBeDefined();
  });

  it("shared-key matches — a mismatch is a 100% cache miss that reports green", () => {
    expect(warmStep.with["shared-key"]).toBe(ciStep.with["shared-key"]);
  });

  it("workspaces match — a different target dir caches the wrong tree", () => {
    expect(warmStep.with.workspaces).toBe(ciStep.with.workspaces);
  });

  it("both pin the SAME rust-cache commit", () => {
    // Two versions can key or lay out the cache differently, which is the same
    // silent miss with a subtler cause.
    expect(warmStep.uses).toBe(ciStep.uses);
  });

  it("rust-cache is pinned to a commit SHA, not a moving tag", () => {
    // House convention for third-party actions (see dtolnay/rust-toolchain,
    // dorny/paths-filter, taiki-e/install-action in ci.yml).
    expect(ciStep.uses).toMatch(/^Swatinem\/rust-cache@[0-9a-f]{40}$/);
  });

  it("neither side persists a cache from a failed compile", () => {
    // A half-written target dir restored on the next run produces failures that
    // reproduce nowhere else.
    expect(String(ciStep.with["cache-on-failure"])).toBe("false");
    expect(String(warmStep.with["cache-on-failure"])).toBe("false");
  });
});

describe("the warmer compiles but never verifies (governance §10)", () => {
  const runs = (warm.jobs.warm.steps ?? []).map((s) => s.run ?? "").join("\n");

  it("does not RUN the Rust test suite", () => {
    // `cargo test --no-run` is the point: build the harness, execute nothing.
    // A bare `cargo test` would re-verify on `main` a tree the PR's required
    // `rust` check already verified — the duplicate §10 exists to prevent.
    const bareCargoTest = runs
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("cargo test") && !l.includes("--no-run"));
    expect(bareCargoTest, "warmer must not execute tests, only compile them").toEqual([]);
  });

  it("does not turn clippy into a gate", () => {
    // `-D warnings` here would make the warmer fail on lint problems that the
    // PR's required check is responsible for — a second, weaker gate on main.
    expect(runs).not.toContain("-D warnings");
  });

  it("runs only on main / schedule / manual — never on pull_request", () => {
    // A PR-triggered warm writes to the PR's own cache scope, which no other
    // PR can read: all of the cost, none of the benefit.
    // `warm.on`, not a `warm[true]` fallback: the `yaml` package parses YAML
    // 1.2, where `on` is the plain string key "on". (Under YAML 1.1 it would
    // have been boolean `true` — a real hazard in GitHub Actions tooling, but
    // not this parser's, and a dead branch here would only look defensive.)
    const on = warm.on;
    expect(on, "`on:` did not parse as a string key — YAML schema changed?").toBeDefined();
    expect(Object.keys(on).sort()).toEqual(["push", "schedule", "workflow_dispatch"]);
    expect(on.push.branches).toEqual(["main"]);
  });
});
