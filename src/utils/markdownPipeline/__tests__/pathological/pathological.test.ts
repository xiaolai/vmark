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
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const ENTRY = join(here, "runCases.ts");

/** Generous: every class together takes well under this on any dev machine
 *  or CI runner; a HANG is minutes-to-forever, so the gap is unambiguous. */
const WALL_CEILING_MS = 60_000;

interface CaseReport {
  name?: string;
  starting?: boolean;
  parseMs?: number;
  serializeMs?: number;
  done?: boolean;
}

function runChild(env: Record<string, string>, timeoutMs: number) {
  const res = spawnSync(TSX, [ENTRY], {
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
    const { res, lines } = runChild({ HANG_PROBE: "1" }, 3_000);
    expect(res.signal).toBe("SIGKILL");
    // The probe announced itself before hanging — the culprit is nameable.
    expect(lines.some((l) => l.name === "hang-probe" && l.starting)).toBe(true);
    expect(lines.some((l) => l.done)).toBe(false);
  }, 30_000);
});
