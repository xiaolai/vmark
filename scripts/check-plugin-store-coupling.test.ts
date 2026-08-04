/**
 * WI-11 — Four-channel plugin coupling ratchet (decision ledger D3).
 *
 * Tests for the plugin→host coupling gate used by
 * scripts/check-plugin-store-coupling.mjs.
 *
 * The gate exists because the 2026-07-25 goal audit
 * (dev-docs/deep-researches/20260725-extension-goal-progress-audit.md) found
 * plugin files importing `@/stores/` went 97 → 98 across a 192-commit refactor
 * whose stated purpose was decoupling. Cross-plugin coupling had a gate and
 * fell 22%; this axis had none and drifted up.
 *
 * Why FOUR channels: the `@/stores` count reached zero, but the app's services
 * are themselves store-coupled (`resolveMediaSrc` → documentStore + tabStore;
 * `unifiedHistory` → five stores), so a plugin importing `@/services` is still
 * un-liftable — the zero could not see it. `@/services`, `@/hooks` and
 * `@/components` are now measured beside `@/stores`.
 *
 * Why per unit AND per channel: a bare global count lets a fixed plugin pay for
 * a newly-coupled one — net zero passes while the ecosystem gets no closer to
 * extractable. Freezing per (unit, channel) fails on BOTH halves of that swap,
 * including a swap that trades one channel for another inside one plugin.
 *
 * D3 (RESOLVED): ALL FOUR channels PARSE imports — a literal in a comment or a
 * string is prose in every channel, including the legacy `@/stores` one that
 * used to grep and counted prose (a landmine that cost two debugging rounds,
 * documented in .claude/rules/00-engineering-principles.md). Migrating it is
 * safe because the stores baseline is zero: zero stays zero under either
 * counting rule, so the parser cannot mask a regression.
 *
 * The fixture half runs the REAL script as a subprocess against tmpdir trees
 * (house pattern, scripts/check-mock-boundaries.test.mjs). Every failure case
 * asserts on the MESSAGE, not only the exit code, so a crashing script (also
 * exit 1) cannot fake a pass.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs module without type declarations
import { findCouplingViolations } from "./check-plugin-store-coupling.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-plugin-store-coupling.mjs");

type Channel = "stores" | "services" | "hooks" | "components";
type Counts = Record<string, Partial<Record<Channel, number>>>;
interface Violation {
  unit: string;
  channel: Channel;
  kind: "new" | "grew" | "stale" | "fixed";
  actual: number;
  baseline: number;
}

function check(actual: Counts, baseline: Counts): Violation[] {
  return findCouplingViolations(actual, baseline) as Violation[];
}

/** Create a fixture repo tree: { "src/plugins/foo/index.ts": "…", … } */
function writeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-coupling-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** Run the real gate against a fixture root. `baseline` may be an object
 *  (serialized to JSON) or a raw string (for the malformed-JSON case). */
function runGate(root: string, baseline: unknown) {
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(
    baselinePath,
    typeof baseline === "string" ? baseline : JSON.stringify(baseline, null, 2),
  );
  const res = spawnSync(process.execPath, [SCRIPT, "--root", root, "--baseline", baselinePath], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const EMPTY = { units: {} };

// ─── Pure comparison core ───

describe("findCouplingViolations — the ratchet holds", () => {
  it("passes when every unit/channel exactly matches its baseline", () => {
    expect(
      check(
        { codemirror: { stores: 0, services: 20 }, search: { hooks: 2 } },
        { codemirror: { services: 20 }, search: { hooks: 2 } },
      ),
    ).toEqual([]);
  });

  it("passes on an empty codebase with an empty baseline", () => {
    expect(check({}, {})).toEqual([]);
  });
});

describe("findCouplingViolations — growth is blocked", () => {
  it("flags a baselined plugin that gained coupling in a channel", () => {
    const v = check({ search: { services: 3 } }, { search: { services: 2 } });
    expect(v).toEqual([
      { unit: "search", channel: "services", kind: "grew", actual: 3, baseline: 2 },
    ]);
  });

  it("flags a plugin that is NEW to the baseline (born coupled)", () => {
    const v = check({ search: { services: 2 }, brandNew: { hooks: 1 } }, { search: { services: 2 } });
    expect(v).toEqual([{ unit: "brandNew", channel: "hooks", kind: "new", actual: 1, baseline: 0 }]);
  });

  it("flags a NEW channel inside an already-baselined plugin", () => {
    // The hole a per-unit-only baseline leaves: the plugin is known, so its
    // total is "expected" — but it just grew a second way to reach the app.
    const v = check({ search: { services: 2, components: 1 } }, { search: { services: 2 } });
    expect(v).toEqual([
      { unit: "search", channel: "components", kind: "new", actual: 1, baseline: 0 },
    ]);
  });

  it("catches a net-zero swap ACROSS plugins — the hole a global count misses", () => {
    const v = check({ born: { services: 2 } }, { fixed: { services: 2 } });
    expect(v.map((x) => `${x.unit}/${x.channel}:${x.kind}`).sort()).toEqual([
      "born/services:new",
      "fixed/services:fixed",
    ]);
  });

  it("catches a net-zero swap ACROSS channels inside ONE plugin", () => {
    // Traded a store import for a service import: same plugin, same total,
    // same un-liftability. A per-unit total would call this unchanged.
    const v = check({ search: { services: 1 } }, { search: { stores: 1 } });
    expect(v.map((x) => `${x.channel}:${x.kind}`).sort()).toEqual([
      "services:new",
      "stores:fixed",
    ]);
  });
});

describe("findCouplingViolations — wins must be locked in", () => {
  it("flags a stale baseline when a plugin improved", () => {
    const v = check({ search: { hooks: 1 } }, { search: { hooks: 2 } });
    expect(v).toEqual([{ unit: "search", channel: "hooks", kind: "stale", actual: 1, baseline: 2 }]);
  });

  it("flags a fully decoupled channel still listed in the baseline", () => {
    const v = check({}, { search: { stores: 2 } });
    expect(v).toEqual([{ unit: "search", channel: "stores", kind: "fixed", actual: 0, baseline: 2 }]);
  });
});

describe("findCouplingViolations — reporting", () => {
  it("reports every offending unit, not just the first", () => {
    const v = check(
      { a: { services: 2 }, b: { services: 1 }, c: { services: 3 } },
      { a: { services: 1 }, b: { services: 1 }, c: { services: 1 } },
    );
    expect(v.map((x) => x.unit)).toEqual(["a", "c"]);
  });

  it("orders violations by unit then channel so output is stable across runs", () => {
    const v = check(
      { zeta: { services: 2 }, alpha: { stores: 1, hooks: 2 } },
      { zeta: { services: 1 }, alpha: { hooks: 1 } },
    );
    expect(v.map((x) => `${x.unit}/${x.channel}`)).toEqual([
      "alpha/hooks",
      "alpha/stores",
      "zeta/services",
    ]);
  });

  it("treats a zero count as absent rather than a violation", () => {
    expect(check({ search: { services: 0 } }, {})).toEqual([]);
  });
});

// ─── The real script over fixture trees ───

describe("check-plugin-store-coupling.mjs (four channels over fixture trees)", () => {
  // Case 1 — new @/services import above baseline → exit 1 naming file + channel
  it("fails on a plugin file importing @/services above baseline, naming file and channel", () => {
    const root = writeTree({
      "src/plugins/gallery/render.ts": `import { resolveMediaSrc } from "@/services/media/resolveMediaSrc";\nexport const x = resolveMediaSrc;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/plugins/gallery/render.ts");
    expect(stderr).toContain("services");
  });

  // Case 2 — unrecorded improvement → exit 1, "record the win"
  it("fails when a plugin improved but the win was not recorded in the baseline", () => {
    const root = writeTree({
      "src/plugins/gallery/one.ts": `import { useThing } from "@/hooks/useThing";\nexport const a = useThing;\n`,
      "src/plugins/gallery/two.ts": `export const b = 1;\n`,
    });
    const { status, stderr } = runGate(root, { units: { gallery: { hooks: 2 } } });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("record the win");
  });

  // Case 3 — exact match per plugin per channel → exit 0
  it("passes when every plugin's per-channel counts equal the baseline", () => {
    const root = writeTree({
      "src/plugins/gallery/one.ts": `import { a } from "@/services/media/x";\nimport type { B } from "@/components/Editor/types";\nexport const z = a;\n`,
      "src/plugins/gallery/two.ts": `import { useThing } from "@/hooks/useThing";\nexport const y = useThing;\n`,
    });
    const { status, stdout } = runGate(root, {
      units: { gallery: { services: 1, components: 1, hooks: 1 } },
    });
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Case 4a — prose @/services in a comment → not counted
  it("does not count an @/services literal inside a comment — it parses, it does not grep", () => {
    const root = writeTree({
      "src/plugins/gallery/render.ts":
        `// this used to import @/services/media/resolveMediaSrc\n` +
        `/* see @/services/media/resolveMediaSrc for the old shape */\n` +
        `export const x = 1;\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  // Case 4b — prose @/stores in a comment → not counted (D3: landmine removed)
  it("does not count an @/stores literal in a comment or a string — the landmine is removed", () => {
    const root = writeTree({
      "src/plugins/gallery/render.ts":
        `// a plugin must never import @/stores/tabStore\n` +
        `export const message = "do not import @/stores/tabStore";\n`,
    });
    const { status, stdout } = runGate(root, EMPTY);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Case 5 — type-only import → counted
  it("counts a type-only import — a plugin depending on the app's TYPES is not liftable either", () => {
    const root = writeTree({
      "src/plugins/gallery/render.ts": `import type { MediaKind } from "@/services/media/types";\nexport type X = MediaKind;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/plugins/gallery/render.ts");
    expect(stderr).toContain("services");
  });

  // Case 6 — malformed baseline → exit 1, fail closed
  it("fails closed on a truncated/malformed baseline file", () => {
    const root = writeTree({ "src/plugins/gallery/ok.ts": `export const x = 1;\n` });
    const { status, stderr } = runGate(root, `{"units": {`);
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("baseline");
  });

  it("fails closed when the baseline's units value is not an object", () => {
    const root = writeTree({ "src/plugins/gallery/ok.ts": `export const x = 1;\n` });
    const { status, stderr } = runGate(root, { units: [] });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("units");
  });

  it("fails closed when a baselined channel count is not a number", () => {
    const root = writeTree({ "src/plugins/gallery/ok.ts": `export const x = 1;\n` });
    const { status, stderr } = runGate(root, { units: { gallery: { services: "two" } } });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("baseline");
  });

  it("fails closed on an unknown channel name in the baseline", () => {
    // A typo'd channel would otherwise sit in the file forever, freezing
    // nothing while looking like it froze something.
    const root = writeTree({ "src/plugins/gallery/ok.ts": `export const x = 1;\n` });
    const { status, stderr } = runGate(root, { units: { gallery: { utils: 1 } } });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("channel");
  });

  // Case 7 — plugin on disk with an import, absent from the baseline → exit 1
  it("fails a brand-new plugin directory that is born coupled", () => {
    const root = writeTree({
      "src/plugins/known/a.ts": `import { a } from "@/services/x";\nexport const z = a;\n`,
      "src/plugins/newborn/b.ts": `import { useB } from "@/hooks/useB";\nexport const y = useB;\n`,
    });
    const { status, stderr } = runGate(root, { units: { known: { services: 1 } } });
    expect(status).toBe(1);
    expect(stderr).toContain("newborn");
    expect(stderr).toContain("hooks");
    expect(stderr).not.toContain("known —");
  });

  it("passes a brand-new plugin directory that is born decoupled", () => {
    // Absence from the baseline is only a failure when there IS coupling: a
    // clean plugin must not need an entry, or the file becomes a plugin list.
    const root = writeTree({
      "src/plugins/newborn/b.ts": `import { EditorState } from "@tiptap/pm/state";\nexport const y = EditorState;\n`,
    });
    const { status, stdout } = runGate(root, EMPTY);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Channel completeness: all four are measured, and only those four.
  it("counts all four channels and names each one", () => {
    const root = writeTree({
      "src/plugins/gallery/s.ts": `import { a } from "@/stores/tabStore";\nexport const z1 = a;\n`,
      "src/plugins/gallery/v.ts": `import { b } from "@/services/media/x";\nexport const z2 = b;\n`,
      "src/plugins/gallery/h.ts": `import { c } from "@/hooks/useX";\nexport const z3 = c;\n`,
      "src/plugins/gallery/c.ts": `import { D } from "@/components/Editor/D";\nexport const z4 = D;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    for (const channel of ["stores", "services", "hooks", "components"]) {
      expect(stderr).toContain(channel);
    }
  });

  it("ignores imports that do not reach the four channels", () => {
    const root = writeTree({
      "src/plugins/gallery/a.ts":
        `import { EditorState } from "@tiptap/pm/state";\n` +
        `import { clamp } from "@/utils/math";\n` +
        `import { other } from "@/plugins/shared/hostSettings";\n` +
        `import { rel } from "./sibling";\n` +
        `export const z = [EditorState, clamp, other, rel];\n`,
      "src/plugins/gallery/sibling.ts": `export const rel = 1;\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  it("counts a relative import that climbs out into src/stores/", () => {
    // `../../stores/x` is the same coupling as `@/stores/x` with a disguise.
    const root = writeTree({
      "src/plugins/gallery/a.ts": `import { useTabStore } from "../../stores/tabStore";\nexport const z = useTabStore;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("stores");
  });

  it("counts a dynamic import() and a re-export, not only static imports", () => {
    const root = writeTree({
      "src/plugins/dyn/a.ts": `export const load = () => import("@/hooks/useThing");\n`,
      "src/plugins/reexp/b.ts": `export { thing } from "@/components/Editor/thing";\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/plugins/dyn/a.ts");
    expect(stderr).toContain("src/plugins/reexp/b.ts");
  });

  it("counts a file once per channel however many times it imports from it", () => {
    // The unit is the FILE, as before: two service imports in one file is one
    // coupled file, not two.
    const root = writeTree({
      "src/plugins/gallery/a.ts":
        `import { a } from "@/services/x";\nimport { b } from "@/services/y";\nexport const z = [a, b];\n`,
    });
    const { status, stdout } = runGate(root, { units: { gallery: { services: 1 } } });
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  it("skips test files and __tests__ directories", () => {
    const root = writeTree({
      "src/plugins/gallery/a.test.ts": `import { a } from "@/services/x";\nexport const z = a;\n`,
      "src/plugins/gallery/__tests__/b.ts": `import { b } from "@/stores/tabStore";\nexport const y = b;\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  it("attributes a loose file directly under src/plugins to its own unit", () => {
    const root = writeTree({
      "src/plugins/loose.ts": `import { a } from "@/services/x";\nexport const z = a;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("loose.ts");
  });
});

describe("wiring — the real package.json and the real baseline", () => {
  it("exposes lint:store-coupling and chains it into check:all", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["lint:store-coupling"]).toBe("node scripts/check-plugin-store-coupling.mjs");
    expect(pkg.scripts["check:all"]).toContain("lint:store-coupling");
  });

  it("keeps the @/stores channel at ZERO — the win the other three now protect", () => {
    // Reached zero in 2026-08, and the three new channels exist because zero
    // on this one was not the same as decoupled. Asserted here as well as in
    // the gate so a regression fails a TEST, not only a lint script someone
    // could reach for --write-baseline on.
    const baseline = JSON.parse(
      readFileSync(path.join(REPO, "scripts", "plugin-store-coupling-baseline.json"), "utf8"),
    );
    const coupledToStores = Object.entries(baseline.units as Record<string, Record<string, number>>)
      .filter(([, channels]) => (channels.stores ?? 0) > 0)
      .map(([unit]) => unit);
    expect(coupledToStores).toEqual([]);
  });

  it("freezes only known channels, as non-negative integers", () => {
    const baseline = JSON.parse(
      readFileSync(path.join(REPO, "scripts", "plugin-store-coupling-baseline.json"), "utf8"),
    );
    for (const channels of Object.values(baseline.units as Record<string, Record<string, number>>)) {
      for (const [channel, count] of Object.entries(channels)) {
        expect(["stores", "services", "hooks", "components"]).toContain(channel);
        expect(Number.isInteger(count) && count > 0).toBe(true);
      }
    }
  });
});
