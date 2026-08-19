// Self-tests for the pre-push delta gate. This gate exists so a batch of
// check:all-only failures is found in one parallel pass instead of one per
// 15-minute run — so its OWN correctness (a complete derivation, and truly
// collecting every failure) must be pinned, or it becomes the silent gate it
// exists to prevent.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokedScripts } from "./lib/packageScripts.mjs";
import {
  individualGates,
  computePlan,
  discoverRuntimeFileTests,
  runAll,
  summarize,
  CI_GROUPS,
  FAST_STEPS,
  UNIT_GATES,
} from "./check-predelta.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;

describe("derivation — the delta is complete and cannot drift", () => {
  it("individualGates is every check:static leaf except lint", () => {
    const expected = invokedScripts(scripts, "check:static").filter(
      (g) => g !== "lint" && !CI_GROUPS.includes(g),
    );
    expect(individualGates(scripts)).toEqual(expected);
    // Sanity: the gates that bit us in this very change are in the set.
    for (const g of ["lint:bespoke-buttons", "lint:knip-baseline", "lint:file-size", "test:gates"]) {
      expect(individualGates(scripts)).toContain(g);
    }
  });

  it("covers every check:all gate except what check:fast runs and the bulk app suite", () => {
    const plan = computePlan(scripts, []);
    const covered = new Set([
      ...plan.gates.map((g) => g.name),
      // check:servers / check:build are run as UNITS, covering their leaves.
      ...UNIT_GATES.flatMap((u) => invokedScripts(scripts, u)),
      ...UNIT_GATES,
    ]);
    const fastCovers = new Set([...FAST_STEPS, ...FAST_STEPS.flatMap((s) => invokedScripts(scripts, s))]);
    const checkAllGates = invokedScripts(scripts, "check:all").filter((g) => !CI_GROUPS.includes(g));

    const missed = checkAllGates.filter(
      (g) => !covered.has(g) && !fastCovers.has(g) && g !== "test:coverage",
    );
    // Anything in check:all that predelta neither runs nor delegates to a unit,
    // that check:fast also doesn't run, and that isn't the deliberately-skipped
    // full suite, is a HOLE — the class this gate exists to close.
    expect(missed, `delta gates predelta would miss: ${missed.join(", ")}`).toEqual([]);
  });

  it("deliberately skips the full app suite and check:fast's own steps", () => {
    const { skipped, gates } = computePlan(scripts, []);
    expect(skipped.join(" ")).toContain("test:coverage");
    const names = gates.flatMap((g) => g.argv);
    expect(names).not.toContain("typecheck");
    expect(names).not.toContain("test:changed");
    // `lint` (eslint) is check:fast's; predelta must not re-run it.
    expect(gates.some((g) => g.name === "lint")).toBe(false);
  });

  it("runs check:servers and check:build as units (their build ordering is real)", () => {
    const { gates } = computePlan(scripts, []);
    const names = gates.map((g) => g.name);
    expect(names).toContain("check:servers");
    expect(names).toContain("check:build");
  });

  it("adds the runtime-file test gate only when there are files to run", () => {
    expect(computePlan(scripts, []).gates.some((g) => g.name === "runtime-file app tests")).toBe(false);
    const withTests = computePlan(scripts, ["src/x.test.ts"]);
    const gate = withTests.gates.find((g) => g.name === "runtime-file app tests");
    expect(gate?.argv).toEqual(["pnpm", "exec", "vitest", "run", "src/x.test.ts"]);
  });
});

describe("gate commands are shell-safe", () => {
  it("every gate is an execFile argv array, never a shell string", () => {
    for (const g of computePlan(scripts, ["src/a.test.ts"]).gates) {
      expect(Array.isArray(g.argv)).toBe(true);
      expect(g.argv[0]).toBe("pnpm");
    }
  });
});

describe("runtime-file test discovery — catches the corpus class, drops other tiers", () => {
  it("selects a file that reads files; skips one that does not", () => {
    const picked = discoverRuntimeFileTests([
      { path: "src/a.test.ts", readsFiles: true },
      { path: "src/b.test.ts", readsFiles: false },
    ]);
    expect(picked).toEqual(["src/a.test.ts"]);
  });

  it("excludes the soak and webkit tiers even when they read files", () => {
    const picked = discoverRuntimeFileTests([
      { path: "src/x.soak.test.ts", readsFiles: true },
      { path: "src/y.webkit.test.ts", readsFiles: true },
      { path: "src/z.test.ts", readsFiles: true },
    ]);
    expect(picked).toEqual(["src/z.test.ts"]);
  });

  it("the corpus round-trip test reads files directly, so it IS discoverable (regression pin)", () => {
    // This is the exact test that failed check:all when release-smoke.yml was
    // added but check:fast passed — it enumerates .github/workflows at runtime.
    const body = readFileSync(
      join(ROOT, "src/lib/ghaWorkflow/save/__tests__/corpusRoundtrip.test.ts"),
      "utf8",
    );
    expect(/\breadFileSync\b|\breaddirSync\b/.test(body)).toBe(true);
  });
});

describe("collect-all — a failure never short-circuits the rest", () => {
  it("runs every gate even when some fail, and reports each failure", async () => {
    // A fake spawn: gates named 'fail-*' exit 1, others exit 0.
    const fakeSpawn = (_cmd, args) => {
      const name = args.join(" ");
      const handlers = {};
      const child = {
        stdout: { on: (ev, fn) => (handlers[`o${ev}`] = fn) },
        stderr: { on: (ev, fn) => (handlers[`e${ev}`] = fn) },
        on: (ev, fn) => (handlers[ev] = fn),
      };
      queueMicrotask(() => {
        handlers.oclose?.(); // no-op if not registered
        handlers["odata"]?.(Buffer.from(`ran ${name}`));
        handlers.close?.(name.includes("fail") ? 1 : 0);
      });
      return child;
    };
    const gates = [
      { name: "ok-1", argv: ["pnpm", "ok-1"] },
      { name: "fail-a", argv: ["pnpm", "fail-a"] },
      { name: "ok-2", argv: ["pnpm", "ok-2"] },
      { name: "fail-b", argv: ["pnpm", "fail-b"] },
    ];
    const results = await runAll(gates, { spawnFn: fakeSpawn, concurrency: 2 });
    expect(results).toHaveLength(4); // ALL ran — nothing short-circuited
    const { failed, failures } = summarize(results);
    expect(failed).toBe(2);
    expect(failures.map((f) => f.name).sort()).toEqual(["fail-a", "fail-b"]);
  });
});

describe("this gate is a pre-push helper, not a CI gate", () => {
  it("is wired as an npm script", () => {
    expect(scripts["check:predelta"]).toContain("check-predelta.mjs");
  });

  it("is NOT part of check:all — it must never become a circular CI gate", () => {
    expect(invokedScripts(scripts, "check:all")).not.toContain("check:predelta");
  });
});
