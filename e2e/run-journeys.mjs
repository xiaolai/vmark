#!/usr/bin/env node
/**
 * VMark E2E Journey Runner
 *
 * Drives a LIVE VMark debug build (pnpm tauri:dev) through the Tauri
 * automation bridge on ws://127.0.0.1:9323, running every journey in
 * e2e/journeys/ sequentially over a single connection.
 *
 * Each journey is independent: it creates its own scratch state (tabs /
 * fixture files) and tears it down, restoring the app to the state it found.
 * See e2e/README.md for the full safety model.
 *
 * Usage:
 *   pnpm e2e:journeys
 *   node e2e/run-journeys.mjs [--only <name-substring>] [--port 9323]
 *                             [--host 127.0.0.1] [--timeout 15000]
 *
 * Output: one PASS/FAIL/SKIP line per journey (with timing) on stderr.
 * On failure a native screenshot is written to e2e/artifacts/<journey>-fail.png.
 * Exit code: 0 only if no journey failed.
 */

import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { BridgeClient, evalJs } from "./lib/bridge.mjs";
import { parseArgs } from "./lib/config.mjs";
import { writeScreenshot } from "./lib/artifacts.mjs";
import { getTabs } from "./lib/vmark.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNEYS_DIR = join(__dirname, "journeys");
const ARTIFACTS_DIR = join(__dirname, "artifacts");

/** Hard per-journey cap — every helper poll has its own shorter timeout, so
 *  hitting this means something is genuinely wedged. */
const JOURNEY_CAP_MS = 90000;

const USAGE =
  "Usage: node e2e/run-journeys.mjs [--only <name-substring>] [--port 9323] " +
  "[--host 127.0.0.1] [--timeout 15000]";
const cfg = parseArgs(process.argv.slice(2), { allowOnly: true, usage: USAGE });

async function loadJourneys(only) {
  const files = (await readdir(JOURNEYS_DIR)).filter((f) => f.endsWith(".mjs")).sort();
  const journeys = [];
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(join(JOURNEYS_DIR, file)).href);
    } catch (err) {
      // A targeted --only run must not be blocked by a broken UNRELATED
      // journey module; warn and move on. Full runs still fail loudly.
      if (only) {
        console.error(`  WARN  skipping ${file} — failed to load: ${err?.message ?? err}`);
        continue;
      }
      throw err;
    }
    const journey = mod.default;
    if (!journey?.name || typeof journey.run !== "function") {
      throw new Error(`${file} does not export default { name, run }`);
    }
    journeys.push({ file, ...journey });
  }
  return journeys;
}

async function captureFailureScreenshot(client, journeyName) {
  try {
    return await writeScreenshot(
      client,
      join(ARTIFACTS_DIR, `${journeyName}-fail.png`),
      cfg.timeoutMs
    );
  } catch {
    return null; // screenshot is best-effort diagnostics, never a failure cause
  }
}

function withCap(promise, ms, label) {
  let timer;
  const cap = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `journey exceeded hard cap of ${ms}ms (${label}) — teardown may be incomplete`
      );
      err.isHardCap = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer));
}

async function main() {
  console.error(`VMark E2E journeys — bridge ${cfg.host}:${cfg.port}`);

  const all = await loadJourneys(cfg.only);
  const selected = cfg.only
    ? all.filter((j) => j.name.toLowerCase().includes(cfg.only.toLowerCase()))
    : all;
  if (selected.length === 0) {
    console.error(`No journeys match --only "${cfg.only}". Available: ${all.map((j) => j.name).join(", ")}`);
    process.exit(2);
  }

  const client = new BridgeClient({ idPrefix: "journey" });
  await client.connect(cfg);
  console.error(`Connected. Running ${selected.length}/${all.length} journey(s).\n`);

  // The document window label — every menu emit targets it.
  const windowLabel = await evalJs(
    client,
    `window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? "main"`,
    cfg.timeoutMs
  );

  // Suite-level integrity: the tab bar must look identical after all journeys.
  const initialTabs = await getTabs(client);

  // Run integrity: the webview must be the SAME document for the whole run. A
  // Vite full reload mid-suite (a file added or removed under `src/` re-evaluates
  // `import.meta.glob`; a Rust edit restarts the app) throws the tab store away
  // underneath a journey, which then fails on some downstream symptom — "omnibox
  // null", "Not connected" — that points at the wrong layer. Stamp the document
  // once and check the stamp before every journey and after every failure, so a
  // reload is reported as what it is.
  const runNonce = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await evalJs(client, `(window.__vmarkE2eRunNonce = ${JSON.stringify(runNonce)}, "OK")`, cfg.timeoutMs);
  const reloadedSinceStart = async () =>
    (await evalJs(client, `window.__vmarkE2eRunNonce ?? null`, cfg.timeoutMs).catch(() => null)) !== runNonce;
  const RELOAD_MSG =
    "the webview RELOADED during the run (Vite full reload or app restart — was a " +
    "file under src/ or src-tauri/ touched while the suite was running?)";

  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const journey = selected[i];
    const ctx = {
      cfg,
      windowLabel,
      log: (msg) => console.error(`          · ${msg}`),
    };
    const start = Date.now();

    // A journey may declare the platforms it can run on (e.g. the embedded browser
    // is macOS-only — every other target compiles to an explicit "unsupported"
    // stub). This is a DIFFERENT thing from a skip: a skipped journey means a
    // precondition was not met and coverage was LOST, which is why
    // `coverageRequired` fails the suite. A journey that cannot exist on this
    // platform lost nothing — there is nothing here to cover. Conflating the two
    // would either make the suite permanently red off-macOS or force us to drop
    // `coverageRequired` from the browser rows, which is the coverage-theatre we
    // are trying to avoid.
    const platforms = journey.platforms;
    if (Array.isArray(platforms) && !platforms.includes(process.platform)) {
      console.error(
        `  N/A   ${journey.name} — not applicable on ${process.platform} ` +
          `(runs on: ${platforms.join(", ")})`
      );
      results.push({ name: journey.name, status: "na", ms: 0, platforms });
      continue;
    }

    try {
      if (await reloadedSinceStart()) throw new Error(`refusing to start: ${RELOAD_MSG}`);
      const outcome = await withCap(journey.run(client, ctx), JOURNEY_CAP_MS, journey.name);
      const ms = Date.now() - start;
      if (outcome?.skip) {
        console.error(`  SKIP  ${journey.name} (${ms}ms) — ${outcome.skip}`);
        results.push({
          name: journey.name,
          status: "skip",
          ms,
          reason: outcome.skip,
          coverageRequired: journey.coverageRequired === true,
        });
      } else {
        console.error(`  PASS  ${journey.name} (${ms}ms)`);
        results.push({ name: journey.name, status: "pass", ms });
      }
    } catch (err) {
      const ms = Date.now() - start;
      const shotPath = await captureFailureScreenshot(client, journey.name);
      console.error(`  FAIL  ${journey.name} (${ms}ms)`);
      console.error(`        ${err?.message ?? err}`);
      if (await reloadedSinceStart()) console.error(`        NOTE: ${RELOAD_MSG}`);
      if (shotPath) console.error(`        screenshot: ${shotPath}`);
      results.push({ name: journey.name, status: "fail", ms });
      if (err?.isHardCap) {
        // A capped journey was NOT cancelled — its promise may still be
        // driving the app. Running further journeys would interleave with it
        // and corrupt their results, so abort the suite here.
        console.error(
          `\n  ABORT — capped journey may still be mutating the app; skipping the remaining journeys.`
        );
        for (const rest of selected.slice(i + 1)) {
          console.error(`  SKIP  ${rest.name} — suite aborted after hard-cap timeout`);
          results.push({ name: rest.name, status: "skip", ms: 0 });
        }
        break;
      }
    }
  }

  // Post-suite integrity check (only meaningful for full runs).
  if (!cfg.only) {
    try {
      const finalTabs = await getTabs(client);
      if (JSON.stringify(finalTabs) !== JSON.stringify(initialTabs)) {
        console.error(`  FAIL  state-restoration`);
        console.error(`        tab bar changed across the suite.`);
        console.error(`        before: ${JSON.stringify(initialTabs)}`);
        console.error(`        after:  ${JSON.stringify(finalTabs)}`);
        results.push({ name: "state-restoration", status: "fail", ms: 0 });
      } else {
        console.error(`  PASS  state-restoration (tab bar identical to pre-suite snapshot)`);
        results.push({ name: "state-restoration", status: "pass", ms: 0 });
      }
    } catch (err) {
      console.error(`  FAIL  state-restoration — ${err?.message ?? err}`);
      results.push({ name: "state-restoration", status: "fail", ms: 0 });
    }
  }

  client.close();

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  // A skip is indistinguishable from coverage at a glance: the suite would print
  // "JOURNEYS PASSED" while an invariant the matrix marks ✅ automated silently
  // went unasserted. A journey that declares `coverageRequired` must therefore
  // either assert or fail the run — coverage cannot quietly evaporate.
  const lostCoverage = results.filter((r) => r.status === "skip" && r.coverageRequired);
  for (const r of lostCoverage) {
    console.error(
      `\n  COVERAGE LOST — ${r.name} is marked coverageRequired (✅ automated in ` +
        `dev-docs/e2e-tier0-matrix.md) but skipped: ${r.reason}\n` +
        `  Fix the precondition or downgrade the row; do not leave it skipping.`
    );
  }

  // Not-applicable is reported separately from skipped and NEVER counts as lost
  // coverage — but it is printed, because a run where half the suite silently did
  // not apply should not read the same as a run where everything asserted.
  const notApplicable = results.filter((r) => r.status === "na").length;

  const red = failed > 0 || lostCoverage.length > 0;
  console.error(
    `\n${red ? "JOURNEYS FAILED" : "JOURNEYS PASSED"} — ${passed} passed, ${failed} failed, ` +
      `${skipped} skipped${lostCoverage.length ? ` (${lostCoverage.length} REQUIRED)` : ""}` +
      `${notApplicable ? `, ${notApplicable} n/a on ${process.platform}` : ""}.`
  );
  process.exit(red ? 1 : 0);
}

main().catch((err) => {
  console.error(`FATAL: ${err?.message ?? err}`);
  process.exit(1);
});
