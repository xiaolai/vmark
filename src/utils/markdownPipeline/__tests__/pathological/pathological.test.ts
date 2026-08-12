// @vitest-environment node
/**
 * WI-3.1 — pathological-input freeze guards, in a TERMINABLE child process.
 *
 * Why a child: a synchronous parser hang blocks the event loop, so a vitest
 * timeout cannot interrupt it — the suite would sit until the CI job dies.
 * And in-process `performance.now()` assertions are CI-variance flakes
 * (`../performance.test.ts` keeps its wall-clock checks opt-in for exactly
 * that reason). So the ONLY hard assertion here is liveness under a generous
 * wall ceiling, enforced by killing the child from outside; per-case timings
 * are reported, not asserted.
 *
 * The self-test proves the enforcement is real: a deliberate busy-loop probe
 * (HANG_PROBE=1) must come back KILLED with the culprit named — a harness
 * whose kill path silently broke would otherwise report green forever.
 *
 * @coordinates-with runCases.ts — the child entry (tsx)
 * @coordinates-with pathologicalCases.ts — the case generators
 * @module utils/markdownPipeline/__tests__/pathological/pathological.test
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathologicalCases } from "./pathologicalCases";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const ENTRY = join(here, "runCases.ts");

/** Generous: every class together takes well under this on any dev machine
 *  or CI runner; a HANG is minutes-to-forever, so the gap is unambiguous.
 *
 *  This is a LIVENESS bound, not a performance assertion — per-case timings are
 *  reported, never asserted (see the header). It was 60s, which the gap made
 *  look unambiguous until the machine was saturated: the child pays Node + tsx
 *  startup before it parses anything, and with three suites competing for cores
 *  a perfectly healthy run hit 60023ms and was killed as a "hang". Raising the
 *  bound cannot mask a real hang — that is unbounded, and the child is still
 *  killed and its culprit named — it only stops a busy machine from forging
 *  one. */
const WALL_CEILING_MS = 180_000;

/** Kill window for the self-test probe.
 *
 *  Must cover Node + tsx startup AND the probe announcing itself, because the
 *  assertion is that the culprit is NAMEABLE. At 3s under load the child was
 *  killed before it printed `starting`, so the harness looked broken when it
 *  was working perfectly. */
const HANG_PROBE_WINDOW_MS = 20_000;

interface CaseReport {
  name?: string;
  starting?: boolean;
  parseMs?: number;
  serializeMs?: number;
  done?: boolean;
}

/** Spawn `node --import tsx` DIRECTLY — never `node_modules/.bin/tsx`.
 *
 *  The tsx CLI is a launcher: it spawns the real runner as its own child and
 *  relays SIGINT/SIGTERM to it. SIGKILL is uncatchable, so the relay never
 *  runs — `spawnSync`'s timeout kills the launcher and REPARENTS the runner to
 *  PID 1, where it spins forever. The self-test's deliberate busy loop made
 *  that leak unconditional: every run of this file abandoned a process pegging
 *  a full core, and four of them once cost ~3.5 cores for 20 hours.
 *
 *  SIGTERM is NOT the fix: tsx would then exit normally with 143, so
 *  `res.signal` becomes null and the hang detector below silently stops
 *  detecting hangs. Removing the launcher keeps SIGKILL honest — the direct
 *  child IS the runner, so killing it kills the code under test. */
function runChild(env: Record<string, string>, timeoutMs: number) {
  const res = spawnSync(process.execPath, ["--import", "tsx", ENTRY], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    env: { ...process.env, ...env },
  });
  const lines = (res.stdout ?? "")
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as CaseReport);
  return { res, lines };
}

/** PIDs still running the child entry. `pgrep -f` matches the whole command
 *  line, so it finds a runner abandoned at ANY depth — which is the only way
 *  to observe the leak from in here. */
function survivingRunners(): string[] {
  const res = spawnSync("pgrep", ["-f", ENTRY], { encoding: "utf8" });
  return (res.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Poll until the kill is reaped, or give up. A leaked runner NEVER clears, so
 *  a real regression cannot buy a pass by waiting longer. */
function waitForNoRunners(budgetMs: number): string[] {
  const deadline = Date.now() + budgetMs;
  let alive = survivingRunners();
  while (alive.length > 0 && Date.now() < deadline) {
    spawnSync("sleep", ["0.25"]);
    alive = survivingRunners();
  }
  return alive;
}

describe("pathological inputs (killable child process)", () => {
  it("every pathological class parses and serializes within the wall ceiling", () => {
    const { res, lines } = runChild({}, WALL_CEILING_MS);

    const started = lines.filter((l) => l.starting && l.name).map((l) => l.name);
    const finished = new Set(lines.filter((l) => l.parseMs !== undefined).map((l) => l.name));
    const lastStarted = started.at(-1);

    expect(
      res.signal,
      `child was killed — the class that hung: ${String(lastStarted)} ` +
        `(finished: ${[...finished].join(", ") || "none"})\nstderr: ${res.stderr}`,
    ).toBeNull();
    expect(res.status, `child failed\nstderr: ${res.stderr}`).toBe(0);
    expect(lines.some((l) => l.done)).toBe(true);

    const expected = pathologicalCases(1).map((c) => c.name);
    expect([...finished].sort()).toEqual([...expected].sort());
  }, WALL_CEILING_MS + 30_000);

  it("SELF-TEST: a deliberate busy loop is killed and reported, not hung", () => {
    const { res, lines } = runChild({ HANG_PROBE: "1" }, HANG_PROBE_WINDOW_MS);
    expect(res.signal).toBe("SIGKILL");
    // The probe announced itself before hanging — the culprit is nameable.
    expect(lines.some((l) => l.name === "hang-probe" && l.starting)).toBe(true);
    expect(lines.some((l) => l.done)).toBe(false);

    // REGRESSION GUARD: the kill must reach the code under test, not just its
    // launcher. Reintroduce a wrapper between us and the runner (see
    // runChild) and this probe silently abandons a core-pegging process on
    // every run — while every assertion above still passes.
    if (process.platform !== "win32") {
      expect(
        waitForNoRunners(5_000),
        "the killed probe left a process running the child entry: it was " +
          "reparented to PID 1 and is now spinning on a core forever",
      ).toEqual([]);
    }
  }, HANG_PROBE_WINDOW_MS + 30_000);
});
