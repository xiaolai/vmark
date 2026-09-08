/**
 * Purpose: join e2e/README.md's journey inventory to what e2e/run-journeys.mjs
 *   would discover and run (WI-FL0.6).
 *
 * The README says "N user journeys". The number was typed by hand, and the
 * directory it describes has files numbered 01–37 with a gap, so a file count,
 * a highest-number count and a runnable-module count are three different
 * numbers. This join reports the one the runner would execute.
 *
 * Discovery MIRRORS the runner rather than importing it: `run-journeys.mjs`
 * parses argv and connects to a live app at module top level, so it cannot be
 * imported for its loader. The mirror is pinned: `runnerDiscoveryDrift` fails
 * when the runner's source no longer contains the discovery and validation
 * lines mirrored here (`RUNNER_DISCOVERY_MARKERS`), so the two cannot drift
 * silently.
 *
 *   runner                                       | here
 *   ---------------------------------------------|---------------------------------
 *   readdir → *.mjs → sort → import(file URL)    | the same
 *   default `{ name, run }` or throw             | a finding naming the file
 *   `platforms` array → n/a off those platforms  | executed-per-platform counts
 *
 * Validation here requires `name` to be a non-empty STRING where the runner
 * requires only truthiness; every journey has one, and a non-string name would
 * break `--only` matching and the README table anyway.
 *
 * Findings: an unloadable or malformed module, a duplicated name, a README
 * count that disagrees with the runnable count, a drifted runner, and any I/O
 * handle (socket, server, pipe, child process) a module opened on import — the
 * runner imports every journey before it connects, so a module that connects on
 * import would run against nothing. Numbering gaps and per-platform counts are
 * information, never findings: a number is a sort key, not a count.
 *
 * Doc-join module contract (consumed by scripts/check-doc-joins.mjs):
 *   `id`, `DEFAULT_PATHS`, `run({ root, paths }) → { findings, info }`.
 *
 * @coordinates-with e2e/run-journeys.mjs — the discovery this mirrors
 * @coordinates-with e2e/README.md — the inventory claim
 * @module scripts/lib/docJoins/journeyInventory
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const id = "journey-inventory";

export const DEFAULT_PATHS = {
  readme: "e2e/README.md",
  journeysDir: "e2e/journeys",
  runner: "e2e/run-journeys.mjs",
};

/** The platforms the runner can report a journey as executed or n/a on. */
export const PLATFORMS = ["darwin", "linux", "win32"];

/** Runner lines this module mirrors; losing one means the mirror must be revisited. */
export const RUNNER_DISCOVERY_MARKERS = [
  '.filter((f) => f.endsWith(".mjs")).sort()',
  'if (!journey?.name || typeof journey.run !== "function")',
  "if (Array.isArray(platforms) && !platforms.includes(process.platform))",
];

/** Active-resource types that mean a module reached outside the process on import. */
const IO_HANDLE_TYPES = new Set(["TCPSocketWrap", "TCPServerWrap", "PipeWrap", "PipeServerWrap", "ProcessWrap", "UDPWrap"]);

function activeResources() {
  return typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo() : null;
}

/** I/O handle types with more live instances in `after` than in `before`; [] when either is unavailable. */
export function newIoHandles(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const tally = (list) => list.reduce((m, type) => m.set(type, (m.get(type) ?? 0) + 1), new Map());
  const was = tally(before);
  const now = tally(after);
  return [...now.keys()].filter((type) => IO_HANDLE_TYPES.has(type) && now.get(type) > (was.get(type) ?? 0)).sort();
}

/** A finding for a module the runner would refuse, or null when it satisfies `export default { name, run }`. */
export function validateJourneyModule(file, mod) {
  const journey = mod?.default;
  if (journey === null || typeof journey !== "object") {
    return `${file}: no default export — the runner requires \`export default { name, run }\``;
  }
  if (typeof journey.name !== "string" || journey.name.length === 0) {
    return `${file}: default export has no string \`name\` — the runner requires \`{ name, run }\``;
  }
  if (typeof journey.run !== "function") {
    return `${file}: default export has no \`run\` function — the runner requires \`{ name, run }\``;
  }
  return null;
}

/**
 * Import every `*.mjs` in `dir` the way the runner does. Returns the runnable
 * journeys, a finding per module the runner would refuse, every `.mjs` file
 * name (for numbering), and the I/O handle types importing opened (null when
 * the check is unavailable on this Node).
 */
export async function discoverJourneys(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  const journeys = [];
  const findings = [];
  const before = activeResources();
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(join(dir, file)).href);
    } catch (err) {
      findings.push(`${file}: failed to load — ${err?.message ?? err}`);
      continue;
    }
    const problem = validateJourneyModule(file, mod);
    if (problem) {
      findings.push(problem);
      continue;
    }
    const { name, platforms, run: runJourney } = mod.default;
    journeys.push({ file, name, platforms, run: runJourney });
  }
  const after = activeResources();
  const ioHandlesOpened = before && after ? newIoHandles(before, after) : null;
  if (ioHandlesOpened?.length) {
    findings.push(
      `${dir}: importing the journeys opened ${ioHandlesOpened.join(", ")} — a journey must not connect on import (the runner imports every module before it connects)`,
    );
  }
  return { journeys, findings, files, ioHandlesOpened };
}

/** One finding per name shared by two or more journey files. */
export function duplicateNames(journeys) {
  const byName = new Map();
  for (const j of journeys) byName.set(j.name, [...(byName.get(j.name) ?? []), j.file]);
  return [...byName]
    .filter(([, files]) => files.length > 1)
    .map(
      ([name, files]) =>
        `journey name "${name}" is used by ${files.length} files: ${files.join(", ")} — names must be unique (the runner's --only and the README table key on them)`,
    );
}

/** Journeys the runner would execute per platform: no `platforms` array means every platform. */
export function platformCounts(journeys, platforms = PLATFORMS) {
  const counts = {};
  for (const p of platforms) {
    counts[p] = journeys.filter((j) => !Array.isArray(j.platforms) || j.platforms.includes(p)).length;
  }
  return counts;
}

/** Numbers missing between the lowest and highest `NN-` prefix, numbers used twice, and files with no prefix. */
export function numberingGaps(files) {
  const numbers = [];
  const unnumbered = [];
  for (const file of files) {
    const m = /^(\d+)-/.exec(file);
    if (m) numbers.push(Number(m[1]));
    else unnumbered.push(file);
  }
  const seen = new Map();
  for (const n of numbers) seen.set(n, (seen.get(n) ?? 0) + 1);
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([n]) => n).sort((a, b) => a - b);
  const gaps = [];
  if (numbers.length > 0) {
    for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) if (!seen.has(n)) gaps.push(n);
  }
  return { gaps, duplicated, unnumbered };
}

/** The `N` of "N user journeys" in the Journeys row of the harness table, or null. */
export function parseReadmeJourneyCount(readme) {
  const m = /^\|\s*Journeys\s*\|[^|\n]*\|\s*(\d+)\s+user journeys\b/m.exec(readme);
  return m ? Number(m[1]) : null;
}

/** One finding per mirrored runner line the runner no longer contains. */
export function runnerDiscoveryDrift(runnerSource) {
  return RUNNER_DISCOVERY_MARKERS.filter((marker) => !runnerSource.includes(marker)).map(
    (marker) =>
      `e2e/run-journeys.mjs no longer contains \`${marker}\` — its discovery or validation changed; update the mirror in scripts/lib/docJoins/journeyInventory.mjs`,
  );
}

/** Discover the journeys under `root` and join them to the README's inventory claim. */
export async function run({ root, paths = DEFAULT_PATHS } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("journeyInventory.run({ root }) requires the repository root");
  const findings = [];
  const info = [];

  const discovered = await discoverJourneys(resolve(root, paths.journeysDir));
  const { journeys, files, ioHandlesOpened } = discovered;
  findings.push(...discovered.findings, ...duplicateNames(journeys));
  findings.push(...runnerDiscoveryDrift(readFileSync(resolve(root, paths.runner), "utf8")));

  const claimed = parseReadmeJourneyCount(readFileSync(resolve(root, paths.readme), "utf8"));
  if (claimed === null) {
    findings.push(`${paths.readme}: the Journeys row of the harness table carries no "N user journeys" count`);
  } else if (claimed !== journeys.length) {
    findings.push(`${paths.readme} claims ${claimed} user journeys; ${paths.journeysDir} has ${journeys.length} runnable journey modules`);
  }

  const counts = platformCounts(journeys);
  info.push(
    `${paths.journeysDir}: ${journeys.length} journey modules; executed per platform — ${PLATFORMS.map((p) => `${p} ${counts[p]}`).join(", ")}`,
  );
  const { gaps, duplicated, unnumbered } = numberingGaps(files);
  info.push(`numbering gaps: ${gaps.length ? gaps.join(", ") : "none"} (a number is a sort key, not a count)`);
  if (duplicated.length) info.push(`numbers used twice: ${duplicated.join(", ")}`);
  if (unnumbered.length) info.push(`unnumbered journey files: ${unnumbered.join(", ")}`);
  if (ioHandlesOpened === null) info.push("import side effects: unchecked (process.getActiveResourcesInfo unavailable)");
  else if (ioHandlesOpened.length === 0) info.push("import side effects: none — no I/O handle opened while importing the journeys");
  return { findings, info };
}
