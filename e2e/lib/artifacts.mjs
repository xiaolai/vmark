/**
 * Screenshot artifact capture for the E2E harnesses.
 *
 * Purpose: one implementation of "capture a native screenshot over the
 * bridge, decode the base64 data URL, write a PNG" shared by `e2e/smoke.mjs`
 * (where a failed capture fails the run) and `e2e/run-journeys.mjs` (where a
 * failure screenshot is best-effort diagnostics and never a failure cause —
 * the runner wraps this in its own try/catch).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expectSuccess } from "./bridge.mjs";

/**
 * Capture a native PNG screenshot of the main window via the bridge.
 * Throws if the bridge reports failure or returns a malformed payload.
 *
 * @returns {Promise<Buffer>} Decoded PNG bytes.
 */
export async function captureScreenshotPng(client, timeoutMs) {
  const shot = expectSuccess(
    await client.send(
      "capture_native_screenshot",
      { format: "png", windowLabel: "main" },
      timeoutMs
    ),
    "capture_native_screenshot"
  );
  const dataUrl = typeof shot === "string" ? shot : shot?.dataUrl ?? shot?.data;
  if (typeof dataUrl !== "string" || !dataUrl.includes("base64,")) {
    throw new Error(
      `Screenshot did not return a base64 data URL: ${JSON.stringify(shot).slice(0, 120)}`
    );
  }
  const base64 = dataUrl.slice(dataUrl.indexOf("base64,") + "base64,".length);
  return Buffer.from(base64, "base64");
}

/**
 * Capture a screenshot and write it to `outPath` (creating the directory).
 * Throws on any capture or write failure; returns `outPath` on success.
 */
export async function writeScreenshot(client, outPath, timeoutMs) {
  const png = await captureScreenshotPng(client, timeoutMs);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, png);
  return outPath;
}
