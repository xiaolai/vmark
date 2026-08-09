/**
 * Wait until the debug app is actually DRIVABLE, not merely listening.
 *
 * Why this exists: a TCP connect to 127.0.0.1:9323 succeeds the instant the
 * bridge binds its listener, which happens during Tauri setup — before the
 * window exists and long before the webview has loaded. CI's readiness probe
 * used a bare `/dev/tcp` connect, so the first run that got that far reported
 * "bridge up after 1s" and then failed all eight journeys in 800ms with
 * `execute_js failed: Window 'main' not found` (run 31298694760, 2026-08-09).
 *
 * The socket was a proxy for readiness. This checks the property instead:
 *   1. a WebSocket session can be established, AND
 *   2. `list_windows` reports the target window label, AND
 *   3. `execute_js` in that window returns — i.e. the webview is running JS,
 *      which is the thing every journey actually needs.
 *
 * Step 3 is not redundant with step 2. A window can be listed while its webview
 * is still loading, and "the window exists" is the same shape of proxy as "the
 * port is open" — one layer further in. The gate is whether JS evaluates.
 *
 * Usage:
 *   node e2e/wait-ready.mjs [--port 9323] [--window main] [--timeout-ms 300000]
 *
 * Exit codes: 0 ready · 1 not ready within the budget (prints what it last saw)
 */
import { BridgeClient, expectSuccess } from "./lib/bridge.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const HOST = arg("host", "127.0.0.1");
const PORT = Number(arg("port", "9323"));
const WINDOW = arg("window", "main");
const BUDGET_MS = Number(arg("timeout-ms", "300000"));
const POLL_MS = 1000;

/** One full readiness attempt. Returns null on success, else why it failed. */
async function attempt() {
  const client = new BridgeClient({ idPrefix: "ready" });
  try {
    await client.connect({ host: HOST, port: PORT, timeoutMs: 5000 });
  } catch (err) {
    return `connect: ${err.message}`;
  }
  try {
    const raw = expectSuccess(await client.send("list_windows", {}, 5000), "list_windows");
    // The bridge has returned both shapes across versions; accept either
    // rather than pinning one and failing opaquely if it changes.
    const windows = Array.isArray(raw) ? raw : raw?.windows;
    if (!Array.isArray(windows) || windows.length === 0) {
      return `no windows reported yet (${JSON.stringify(raw)})`;
    }
    const labels = windows.map((w) => (typeof w === "string" ? w : w?.label ?? w?.name));
    if (!labels.includes(WINDOW)) {
      return `window '${WINDOW}' not among [${labels.join(", ")}]`;
    }
    const reply = await client.send("execute_js", { script: "1+1" }, 10000);
    if (reply.success !== true) return `execute_js not ready: ${reply.error ?? "?"}`;
    return null;
  } catch (err) {
    return `probe: ${err.message}`;
  } finally {
    client.close();
  }
}

const deadline = Date.now() + BUDGET_MS;
let last = "no attempt made";
let n = 0;
while (Date.now() < deadline) {
  n += 1;
  last = (await attempt()) ?? "";
  if (last === "") {
    console.log(`app drivable after ${n} attempt(s): window '${WINDOW}' evaluates JS`);
    process.exit(0);
  }
  // Report progress occasionally so a stuck run says what it is stuck on
  // rather than going quiet for five minutes.
  if (n === 1 || n % 15 === 0) console.log(`  [${n}] not ready: ${last}`);
  await new Promise((r) => setTimeout(r, POLL_MS));
}

console.error(`::error::app never became drivable within ${BUDGET_MS}ms — last: ${last}`);
process.exit(1);
