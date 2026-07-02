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

  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const journey = selected[i];
    const ctx = {
      cfg,
      windowLabel,
      log: (msg) => console.error(`          · ${msg}`),
    };
    const start = Date.now();
    try {
      const outcome = await withCap(journey.run(client, ctx), JOURNEY_CAP_MS, journey.name);
      const ms = Date.now() - start;
      if (outcome?.skip) {
        console.error(`  SKIP  ${journey.name} (${ms}ms) — ${outcome.skip}`);
        results.push({ name: journey.name, status: "skip", ms });
      } else {
        console.error(`  PASS  ${journey.name} (${ms}ms)`);
        results.push({ name: journey.name, status: "pass", ms });
      }
    } catch (err) {
      const ms = Date.now() - start;
      const shotPath = await captureFailureScreenshot(client, journey.name);
      console.error(`  FAIL  ${journey.name} (${ms}ms)`);
      console.error(`        ${err?.message ?? err}`);
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
  console.error(
    `\n${failed === 0 ? "JOURNEYS PASSED" : "JOURNEYS FAILED"} — ${passed} passed, ${failed} failed, ${skipped} skipped.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FATAL: ${err?.message ?? err}`);
  process.exit(1);
});
