// Headless Playwright runner for Spike B.
// Starts Vite, opens Chromium, waits for window.__SPIKE_B__.done, captures results.

import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const VITE_PORT = 5274;
const VITE_URL = `http://localhost:${VITE_PORT}/spike-b.html`;

function startVite() {
  const proc = spawn("npx", ["--no-install", "vite"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let resolved = false;
    proc.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      if (s.includes("Local:") || s.includes("ready in")) {
        if (!resolved) {
          resolved = true;
          resolve(proc);
        }
      }
    });
    proc.stderr.on("data", (c) => process.stderr.write(c));
    proc.on("exit", (code) => {
      if (!resolved) reject(new Error(`vite exited with ${code}`));
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(proc);
      }
    }, 8000);
  });
}

async function main() {
  console.log("starting vite…");
  const vite = await startVite();
  // Settle.
  await new Promise((r) => setTimeout(r, 1500));

  console.log("launching chromium…");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[page-error]", msg.text());
  });
  page.on("pageerror", (e) => console.log("[page-exception]", e.message));

  console.log(`opening ${VITE_URL}…`);
  await page.goto(VITE_URL, { waitUntil: "networkidle" });

  console.log("waiting for spike to complete…");
  await page.waitForFunction(
    () => Boolean((window).__SPIKE_B__ && (window).__SPIKE_B__.done),
    null,
    { timeout: 30000 },
  );

  const results = await page.evaluate(() => (window).__SPIKE_B__);
  console.log("\n=== Spike B results ===\n");
  console.log(JSON.stringify(results, null, 2));

  writeFileSync(
    "spike-b-results.json",
    JSON.stringify(results, null, 2),
    "utf8",
  );

  await browser.close();
  vite.kill("SIGTERM");
  // Force-kill if still alive.
  setTimeout(() => {
    try { vite.kill("SIGKILL"); } catch {}
  }, 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
