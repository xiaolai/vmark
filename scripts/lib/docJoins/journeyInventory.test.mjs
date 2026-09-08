// WI-FL0.6 — journey-inventory doc join: e2e/README.md's journey count against what the runner discovers.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PATHS,
  PLATFORMS,
  RUNNER_DISCOVERY_MARKERS,
  discoverJourneys,
  duplicateNames,
  id,
  newIoHandles,
  numberingGaps,
  parseReadmeJourneyCount,
  platformCounts,
  run,
  runnerDiscoveryDrift,
  validateJourneyModule,
} from "./journeyInventory.mjs";

const REPO = resolve(import.meta.dirname, "../../..");
const RUNNER_SOURCE = readFileSync(resolve(REPO, DEFAULT_PATHS.runner), "utf8");

// ── fixtures ───────────────────────────────────────────────────────────────

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "journey-inventory-"));
  dirs.push(dir);
  return dir;
}

/** A journey module in the runner's contract: `export default { name, run }`. */
function journey(name, extra = "") {
  return `export default {\n  name: ${JSON.stringify(name)},\n${extra}  async run() {},\n};\n`;
}

function journeysDir(files) {
  const dir = join(scratch(), "journeys");
  mkdirSync(dir);
  for (const [file, source] of Object.entries(files)) writeFileSync(join(dir, file), source);
  return dir;
}

function readme(count) {
  return [
    "# VMark E2E Harnesses",
    "",
    "| Harness | Command | Scope |",
    "|---------|---------|-------|",
    "| Smoke | `pnpm e2e:smoke` | Minimal happy path: connect → scratch tab |",
    `| Journeys | \`pnpm e2e:journeys\` | ${count} user journeys covering jsdom-unreachable flows |`,
    "",
    "Shared bridge client: `e2e/lib/bridge.mjs`.",
    "",
  ].join("\n");
}

/** A repo-shaped tree: e2e/journeys, the real runner source, and a README claiming `count`. */
function tree({ journeys, count }) {
  const root = scratch();
  mkdirSync(join(root, "e2e/journeys"), { recursive: true });
  for (const [file, source] of Object.entries(journeys)) writeFileSync(join(root, "e2e/journeys", file), source);
  writeFileSync(join(root, "e2e/run-journeys.mjs"), RUNNER_SOURCE);
  writeFileSync(join(root, "e2e/README.md"), readme(count));
  return root;
}

const THREE = {
  "01-boot.mjs": journey("boot-editor-ready"),
  "02-tabs.mjs": journey("tab-lifecycle"),
  "03-browser.mjs": journey("browser-open", '  platforms: ["darwin"],\n'),
};

// ── discovery mirrors the runner ───────────────────────────────────────────

describe("discoverJourneys", () => {
  it("imports every *.mjs in filename order and reads name, platforms and run", async () => {
    const { journeys, findings } = await discoverJourneys(journeysDir(THREE));
    expect(findings).toEqual([]);
    expect(journeys.map((j) => j.file)).toEqual(["01-boot.mjs", "02-tabs.mjs", "03-browser.mjs"]);
    expect(journeys.map((j) => j.name)).toEqual(["boot-editor-ready", "tab-lifecycle", "browser-open"]);
    expect(journeys[2].platforms).toEqual(["darwin"]);
    expect(journeys[0].platforms).toBeUndefined();
  });

  it("ignores files the runner ignores — anything that is not .mjs", async () => {
    const { journeys, findings } = await discoverJourneys(
      journeysDir({ ...THREE, "notes.md": "# not a journey", "helper.js": "export const x = 1;" }),
    );
    expect(findings).toEqual([]);
    expect(journeys).toHaveLength(3);
  });

  it("flags a module without a run function, naming the file, and keeps the others", async () => {
    const { journeys, findings } = await discoverJourneys(
      journeysDir({ ...THREE, "04-broken.mjs": 'export default { name: "no-run" };\n' }),
    );
    expect(journeys).toHaveLength(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/04-broken\.mjs/);
    expect(findings[0]).toMatch(/run/);
  });

  it("flags a module whose name is not a non-empty string", async () => {
    const { findings } = await discoverJourneys(
      journeysDir({ "05-unnamed.mjs": "export default { name: 42, async run() {} };\n" }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/05-unnamed\.mjs/);
    expect(findings[0]).toMatch(/name/);
  });

  it("flags a module with no default export", async () => {
    const { findings } = await discoverJourneys(
      journeysDir({ "06-named-only.mjs": "export const name = 'x'; export async function run() {}\n" }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/06-named-only\.mjs/);
  });

  it("flags a module that fails to load, naming the file — the runner throws here on a full run", async () => {
    const { journeys, findings } = await discoverJourneys(
      journeysDir({ ...THREE, "07-syntax.mjs": "export default { name: 'x', run( {} };\n" }),
    );
    expect(journeys).toHaveLength(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/07-syntax\.mjs/);
    expect(findings[0]).toMatch(/load/);
  });
});

describe("validateJourneyModule", () => {
  it("accepts exactly the shape the runner accepts", () => {
    expect(validateJourneyModule("ok.mjs", { default: { name: "x", run() {} } })).toBeNull();
    expect(validateJourneyModule("ok.mjs", { default: { name: "x", platforms: ["darwin"], run: async () => {} } })).toBeNull();
  });

  it("names the file and the missing piece for every shape the runner refuses", () => {
    expect(validateJourneyModule("a.mjs", {})).toMatch(/^a\.mjs: no default export/);
    expect(validateJourneyModule("b.mjs", { default: null })).toMatch(/^b\.mjs: no default export/);
    expect(validateJourneyModule("c.mjs", { default: "journey" })).toMatch(/^c\.mjs: no default export/);
    expect(validateJourneyModule("d.mjs", { default: { run() {} } })).toMatch(/^d\.mjs: .*\bname\b/);
    expect(validateJourneyModule("e.mjs", { default: { name: "", run() {} } })).toMatch(/^e\.mjs: .*\bname\b/);
    expect(validateJourneyModule("f.mjs", { default: { name: 42, run() {} } })).toMatch(/^f\.mjs: .*\bname\b/);
    expect(validateJourneyModule("g.mjs", { default: { name: "x" } })).toMatch(/^g\.mjs: .*\brun\b/);
    expect(validateJourneyModule("h.mjs", { default: { name: "x", run: "later" } })).toMatch(/^h\.mjs: .*\brun\b/);
  });
});

describe("duplicateNames", () => {
  it("flags a name two files share, naming both files", () => {
    const findings = duplicateNames([
      { file: "01-a.mjs", name: "same" },
      { file: "02-b.mjs", name: "other" },
      { file: "03-c.mjs", name: "same" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/"same"/);
    expect(findings[0]).toMatch(/01-a\.mjs/);
    expect(findings[0]).toMatch(/03-c\.mjs/);
  });

  it("is quiet when every name is unique", () => {
    expect(duplicateNames([{ file: "a", name: "x" }, { file: "b", name: "y" }])).toEqual([]);
  });
});

describe("platformCounts", () => {
  it("counts a journey without platforms on every platform and a scoped one only where it runs", () => {
    const counts = platformCounts([
      { name: "a" },
      { name: "b", platforms: ["darwin"] },
      { name: "c", platforms: ["linux", "win32"] },
      { name: "d", platforms: "darwin" }, // not an array: the runner runs it everywhere
    ]);
    expect(PLATFORMS).toEqual(["darwin", "linux", "win32"]);
    expect(counts).toEqual({ darwin: 3, linux: 3, win32: 3 });
  });
});

describe("numberingGaps", () => {
  it("reports missing numbers, unnumbered files and duplicated numbers", () => {
    expect(numberingGaps(["01-a.mjs", "02-b.mjs", "04-c.mjs", "04-d.mjs", "x.mjs"])).toEqual({
      gaps: [3],
      duplicated: [4],
      unnumbered: ["x.mjs"],
    });
  });

  it("reports nothing for a contiguous series", () => {
    expect(numberingGaps(["01-a.mjs", "02-b.mjs", "03-c.mjs"])).toEqual({ gaps: [], duplicated: [], unnumbered: [] });
  });

  it("handles an empty list", () => {
    expect(numberingGaps([])).toEqual({ gaps: [], duplicated: [], unnumbered: [] });
  });
});

describe("parseReadmeJourneyCount", () => {
  it("reads the count from the Journeys row of the harness table", () => {
    expect(parseReadmeJourneyCount(readme(35))).toBe(35);
  });

  it("returns null when the Journeys row carries no count", () => {
    expect(parseReadmeJourneyCount("| Journeys | `pnpm e2e:journeys` | many journeys |")).toBeNull();
    expect(parseReadmeJourneyCount("# nothing\n\n| Smoke | x | 3 user journeys |")).toBeNull();
  });
});

describe("runnerDiscoveryDrift", () => {
  it("is quiet on the real runner", () => {
    expect(runnerDiscoveryDrift(RUNNER_SOURCE)).toEqual([]);
  });

  it("flags each discovery/validation marker the runner no longer contains", () => {
    const drifted = RUNNER_SOURCE.replace('.endsWith(".mjs")', '.endsWith(".js")');
    const findings = runnerDiscoveryDrift(drifted);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/\.mjs/);
    expect(RUNNER_DISCOVERY_MARKERS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("newIoHandles", () => {
  it("reports I/O handle types that appeared during import and ignores file reads", () => {
    expect(newIoHandles(["FSReqPromise"], ["FSReqPromise", "FSReqPromise", "TCPSocketWrap"])).toEqual([
      "TCPSocketWrap",
    ]);
    expect(newIoHandles([], ["FSReqPromise", "Timeout"])).toEqual([]);
    expect(newIoHandles(["TCPSocketWrap"], ["TCPSocketWrap"])).toEqual([]);
  });
});

// ── run() ──────────────────────────────────────────────────────────────────

describe("run() against a fixture tree", () => {
  it("reports zero findings when the README count equals the discovered count, with per-platform info", async () => {
    const { findings, info } = await run({ root: tree({ journeys: THREE, count: 3 }) });
    expect(findings).toEqual([]);
    const text = info.join("\n");
    expect(text).toMatch(/3 journey modules/);
    expect(text).toMatch(/darwin 3, linux 2, win32 2/);
    expect(text).toMatch(/numbering gaps: none/);
  });

  it("flags a README count that disagrees with discovery, naming both numbers", async () => {
    const { findings } = await run({ root: tree({ journeys: THREE, count: 35 }) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/35/);
    expect(findings[0]).toMatch(/\b3\b/);
  });

  it("counts only runnable modules against the README and reports the broken one", async () => {
    const journeys = { ...THREE, "04-broken.mjs": 'export default { name: "no-run" };\n' };
    const { findings } = await run({ root: tree({ journeys, count: 4 }) });
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => /04-broken\.mjs/.test(f))).toBe(true);
    expect(findings.some((f) => /claims 4/.test(f) && /\b3\b/.test(f))).toBe(true);
  });

  it("flags duplicate names", async () => {
    const journeys = { ...THREE, "04-dup.mjs": journey("tab-lifecycle") };
    const { findings } = await run({ root: tree({ journeys, count: 4 }) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/"tab-lifecycle"/);
  });

  it("reports numbering gaps as information, not findings", async () => {
    const journeys = { "01-a.mjs": journey("a"), "03-c.mjs": journey("c"), "05-e.mjs": journey("e") };
    const { findings, info } = await run({ root: tree({ journeys, count: 3 }) });
    expect(findings).toEqual([]);
    expect(info.join("\n")).toMatch(/numbering gaps: 2, 4/);
  });

  it("flags a README whose Journeys row has no count", async () => {
    const root = tree({ journeys: THREE, count: 3 });
    writeFileSync(join(root, "e2e/README.md"), "# no table here\n");
    const { findings } = await run({ root });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/user journeys/);
  });

  it("refuses to run without a root", async () => {
    await expect(run()).rejects.toThrow(/root/);
  });
});

// ── live tree ──────────────────────────────────────────────────────────────

describe("live tree", () => {
  it("exports the doc-join contract", () => {
    expect(id).toBe("journey-inventory");
    expect(Object.keys(DEFAULT_PATHS).sort()).toEqual(["journeysDir", "readme", "runner"]);
  });

  it("reports zero findings: every e2e/journeys module is runnable, names are unique, the README count is right", async () => {
    const { findings, info } = await run({ root: REPO });
    expect(findings).toEqual([]);

    const files = readdirSync(resolve(REPO, DEFAULT_PATHS.journeysDir)).filter((f) => f.endsWith(".mjs"));
    const line = info.find((l) => /journey modules/.test(l));
    const m = /(\d+) journey modules; executed per platform — darwin (\d+), linux (\d+), win32 (\d+)/.exec(line);
    expect(m, `info line shape: ${line}`).not.toBeNull();
    const [total, darwin, linux, win32] = m.slice(1).map(Number);
    expect(total).toBe(files.length);
    // The embedded browser is macOS-only, so darwin runs everything and the other two run the same subset.
    expect(darwin).toBe(total);
    expect(linux).toBe(win32);
    expect(linux).toBeLessThan(darwin);
    expect(info.some((l) => /numbering gaps: /.test(l))).toBe(true);
  });
});
