#!/usr/bin/env node
/**
 * Spike-artifact checker for the agent edit ledger's phase-0 gate: one area's
 * `results.json` under `GRILLS_DIR/<area>/` (maintainer-local) is present,
 * well-formed, fresh, and records a passing verdict.
 *
 * "Fresh" means the recorded numbers describe the probe as it is NOW:
 *   - `generatedAt` is an ISO-8601 date-time, not in the future (5 min skew);
 *   - the artifact's `fingerprint` — the sha256 of every input its generator
 *     read when the run started: the spike's sources, its lockfile and
 *     package.json/Cargo.toml, the folders its probes import or read, every
 *     file their import graph reaches (src/ modules, transitively) and the
 *     lockfiles pinning the packages they import — equals the
 *     fingerprint recomputed now. Both sides call the ONE implementation,
 *     scripts/lib/alSpikeFingerprint.mjs, which defines the inputs. A changed,
 *     added or removed input is stale and named; a touched-but-unchanged
 *     file is not (content, not mtime);
 *   - the area holds at least one probe source of its own (code, not just a
 *     manifest or lockfile), so the probe can be re-run.
 * An age limit was rejected: numbers do not rot by sitting still, and a limit
 * would turn a finished phase red with nothing changed.
 *
 * "Recognisable" means the artifact names the work item it reports
 * (`workItem`, or an entry of `workItems`) and carries the verdict its area
 * exists to decide — see SPIKES and scripts/lib/alSpikeVerdicts.mjs.
 *
 * Usage: node scripts/check-al-spike-results.mjs [--root=<dir>] <revert|backend|txn|anchor|review>
 *   exit 0   artifact present, fresh, passing (one ✓ line)
 *   exit 1   one line listing every problem found (an absent results.json is
 *            "missing"; one that exists but cannot be read names the error)
 *   exit 64  bad invocation
 *
 * @coordinates-with scripts/check-al-phase.sh — phase 0 calls this once per area
 * @coordinates-with scripts/lib/alSpikeFingerprint.mjs — the shared input fingerprint
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — the per-area verdicts
 * @coordinates-with scripts/check-al-spike-results.test.mjs — the self-test
 * @module scripts/check-al-spike-results
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { isMainModule } from "./lib/isMainModule.mjs";
import { GRILLS_DIR, diffFingerprints, spikeFingerprint } from "./lib/alSpikeFingerprint.mjs";
import { anchorVerdict, backendVerdict, reviewVerdict, revertVerdict, txnVerdict } from "./lib/alSpikeVerdicts.mjs";

export { GRILLS_DIR };
const FUTURE_SKEW_MS = 5 * 60_000;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_NAMED = 5;
/**
 * A file a probe runs from: code in any language the spikes are written in,
 * never a manifest, a lockfile or a type declaration (`.d.ts`, `.d.mts`, …),
 * which describes code without being any.
 */
const PROBE_SOURCE = /\.(?:[cm]?[jt]sx?|rs)$/;
const DECLARATION = /\.d\.[cm]?tsx?$/;
const isProbeSource = (file) => PROBE_SOURCE.test(file) && !DECLARATION.test(file);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export const SPIKES = {
  revert: { workItem: "WI-AL0.4", verdict: revertVerdict },
  backend: { workItem: "WI-AL0.5", verdict: backendVerdict },
  txn: { workItem: "WI-AL0.8", verdict: txnVerdict },
  anchor: { workItem: "WI-AL0.9", verdict: anchorVerdict },
  review: { workItem: "WI-AL0.6", verdict: reviewVerdict },
};

/**
 * The entries of the repo-relative folder `rel` under `root` (`[]` when it is
 * absent); throws `cannot read <rel>: <code>` when it exists but cannot be
 * listed, so the caller can report it as one problem.
 */
function listFolder(root, rel, { recursive = false }) {
  const dir = path.join(root, rel);
  try {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
    return readdirSync(dir, { recursive, withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read ${rel}: ${error?.code ?? error?.message ?? error}`, { cause: error });
  }
}

/**
 * The txn parity areas phase 0 requires: one per `tests/provenance*.rs` under
 * `root`, sorted (cargo names a test target after its file). A missing folder
 * gives `[]`, which the txn verdict refuses; an unreadable one throws.
 */
export function txnProvenanceAreas(root) {
  const files = listFolder(root, `${GRILLS_DIR}/txn/tests`, {});
  return files.filter((f) => f.isFile() && /^provenance.*\.rs$/.test(f.name)).map((f) => f.name.slice(0, -3)).sort();
}

/**
 * The review probes phase 0 requires: every `*.probe.ts`/`*.probe.tsx` under
 * review/probes, at any depth (the review runner's include), by basename (the
 * key its reporter records), sorted. Two files with one basename appear twice,
 * which the review verdict refuses. A missing folder gives `[]`, which the
 * review verdict refuses; an unreadable one throws.
 */
export function reviewProbeFiles(root) {
  const files = listFolder(root, `${GRILLS_DIR}/review/probes`, { recursive: true });
  return files.filter((f) => f.isFile() && /\.probe\.tsx?$/.test(f.name)).map((f) => f.name).sort();
}

/** `entry` names `id` exactly, or as its first word ("<id> (writer half)") — never as a prefix of a longer id. */
/**
 * The instant an ISO-8601 date-time names, or NaN. Strict: every field is in
 * range for its calendar month (leap years included), so a date JavaScript
 * would silently normalise — February 30, hour 24, offset +24:00 — is NaN.
 */
function isoInstant(stamp) {
  const m = typeof stamp === "string" ? ISO_DATE_TIME.exec(stamp) : null;
  if (!m) return NaN;
  const [year, month, day, hour, minute, second = 0, offH = 0, offM = 0] = m.slice(1).map((v) => (v === undefined ? undefined : Number(v)));
  const daysInMonth = new Date(new Date(0).setUTCFullYear(year, month, 0)).getUTCDate(); // setUTCFullYear: no 1900 offset for years < 100
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offH > 23 || offM > 59) return NaN;
  return Date.parse(stamp);
}

const namesWorkItem = (entry, id) => typeof entry === "string" && (entry === id || entry.startsWith(`${id} `));

const listed = (verb, paths) =>
  paths.length === 0 ? [] : [`${verb} ${paths.slice(0, MAX_NAMED).join(", ")}${paths.length > MAX_NAMED ? ` and ${paths.length - MAX_NAMED} more` : ""}`];

/** Problems with the recorded fingerprint against the one recomputed now (`current`, or `{ error }`). */
function freshness(spike, recorded, current, stamp) {
  if (isObject(current) && typeof current.error === "string") return [`cannot fingerprint inputs: ${current.error}`];
  const out = [];
  const own = `${GRILLS_DIR}/${spike}/`;
  if (!Object.keys(current.files).some((f) => f.startsWith(own) && isProbeSource(f))) out.push("no probe sources beside results.json — the probe cannot be re-run");
  if (!isObject(recorded) || recorded.algorithm !== "sha256" || typeof recorded.digest !== "string" || !SHA256_HEX.test(recorded.digest) || !isObject(recorded.files)) {
    const note = isObject(recorded) && typeof recorded.note === "string" ? ` (${recorded.note})` : "";
    out.push(`no valid inputs fingerprint (sha256 of sources and lockfiles)${note} — regenerate with the spike's generator`);
  } else if (recorded.digest !== current.digest) {
    const d = diffFingerprints(recorded.files, current.files);
    const what = [...listed("changed", d.changed), ...listed("added", d.added), ...listed("removed", d.removed)];
    out.push(`stale: inputs differ from the run at ${stamp} (${what.join("; ") || "same files, different digest"}) — re-run the probe`);
  }
  return out;
}

/**
 * Every problem with one parsed artifact. Pure: the caller supplies the
 * fingerprint recomputed now (`current`, or `{ error }`), the clock, and the
 * required lists found on disk — txn parity areas (`txnProvenanceAreas`) and
 * review probes (`reviewProbeFiles`); an absent list refuses its area.
 */
export function checkSpikeResult(spike, doc, { current, nowMs, txnProvenanceAreas: provenanceAreas, reviewProbes }) {
  const spec = SPIKES[spike];
  if (!isObject(doc)) return { problems: ["not a JSON object"] };
  const problems = [];
  const items = Array.isArray(doc.workItems) ? doc.workItems : [doc.workItem];
  if (!items.some((e) => namesWorkItem(e, spec.workItem))) problems.push(`does not name ${spec.workItem} in workItem/workItems`);

  const stamp = doc.generatedAt;
  const ms = isoInstant(stamp);
  if (!Number.isFinite(ms)) problems.push(`generatedAt ${JSON.stringify(stamp)} is not an ISO-8601 date-time`);
  else if (ms > nowMs + FUTURE_SKEW_MS) problems.push(`generatedAt ${stamp} is in the future`);
  problems.push(...freshness(spike, doc.fingerprint, current, stamp));
  problems.push(...spec.verdict(doc, { provenanceAreas, reviewProbes }));
  return { problems };
}

const USAGE = `Usage: node scripts/check-al-spike-results.mjs [--root=<dir>] <${Object.keys(SPIKES).join("|")}>`;

/** Parse argv; throws (exit 64) on anything but one known area and an optional existing --root. */
export function parseArgs(argv, defaultRoot) {
  let root = defaultRoot;
  let spike = null;
  for (const a of argv) {
    if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}\n${USAGE}`);
    else if (spike !== null) throw new Error(`expected one spike, got "${spike}" and "${a}"\n${USAGE}`);
    else spike = a;
  }
  if (spike === null) throw new Error(USAGE);
  if (!Object.hasOwn(SPIKES, spike)) throw new Error(`unknown spike "${spike}"\n${USAGE}`);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`--root is not a directory: ${root}`);
  return { root, spike };
}

/** The on-disk list `spike`'s verdict requires (txn parity areas, review probes), or the problem reading its folder. */
function requiredLists(root, spike) {
  const readers = { txn: ["txnProvenanceAreas", txnProvenanceAreas], review: ["reviewProbes", reviewProbeFiles] };
  if (!Object.hasOwn(readers, spike)) return { lists: {}, problems: [] };
  const [key, read] = readers[spike];
  try {
    return { lists: { [key]: read(root) }, problems: [] };
  } catch (error) {
    return { lists: {}, problems: [error.message] };
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), path.resolve(import.meta.dirname, ".."));
  } catch (error) {
    console.error(error.message);
    process.exit(64);
  }
  const { root, spike } = opts;
  const rel = `${GRILLS_DIR}/${spike}/results.json`;
  let text;
  try {
    text = readFileSync(path.join(root, rel), "utf8");
  } catch (error) {
    console.log(error?.code === "ENOENT" ? `missing: ${rel}` : `cannot read ${rel}: ${error?.code ?? error?.message ?? error}`);
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    console.log(`${rel} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  let current;
  try {
    current = spikeFingerprint(root, spike);
  } catch (error) {
    current = { error: error.message };
  }
  const required = requiredLists(root, spike);
  const problems = [...required.problems, ...checkSpikeResult(spike, doc, { current, nowMs: Date.now(), ...required.lists }).problems];
  if (problems.length > 0) {
    console.log(`${rel}: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`${rel} fresh and passing (${SPIKES[spike].workItem}, generatedAt ${doc.generatedAt}, inputs ${doc.fingerprint.digest.slice(0, 12)})`);
}

if (isMainModule(import.meta.url)) main();
