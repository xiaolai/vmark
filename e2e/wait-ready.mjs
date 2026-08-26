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
 *   3. the webview reports itself DRIVABLE — the Tauri APIs callable, the React
 *      shell mounted, and the window's ready handshake complete, which is the
 *      point at which its event listeners exist (`lib/readiness.mjs`).
 *
 * Step 3 is not redundant with step 2. A window can be listed while its webview
 * is still loading, and "the window exists" is the same shape of proxy as "the
 * port is open" — one layer further in.
 *
 * Step 3 USED to be `execute_js "1+1"`, and that was the same mistake a third
 * time: `1+1` evaluates the moment `index.html` parses, long before React
 * mounts. Run 32701401717 (2026-08-24) declared the app ready 6 seconds before
 * it logged `Window 'main' is ready`, and the first journey in line fired
 * `vmark.workspace.new` at a listener that did not exist yet — the event was
 * dropped, and the journey then waited out its budget for a tab that was never
 * coming. `lib/readiness.mjs` records the full reasoning and owns the
 * predicate, which `01-boot-editor-ready` shares.
 *
 * Usage:
 *   node e2e/wait-ready.mjs [--port 9323] [--window main] [--timeout-ms 300000]
 *
 * Exit codes: 0 ready · 1 not ready within the budget (prints what it last saw)
 */
import { BridgeClient, expectSuccess } from "./lib/bridge.mjs";
import { DRIVABLE_SNIPPET, drivableGap } from "./lib/readiness.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  // The flag was GIVEN, so a missing or option-shaped value is a mistake, not a
  // request for the default: `--port --window main` used to take "--window" as
  // the port and `Number()` it to NaN. Falling back silently would hide the
  // typo just as effectively as the NaN did.
  if (value === undefined || value.startsWith("--")) {
    console.error(`::error::--${name} was given without a value`);
    process.exit(2);
  }
  return value;
}

/**
 * Parse a positive-integer argument, or die saying which one was wrong.
 *
 * `Number()` alone turned a typo into a silent misconfiguration: NaN for
 * `--port abc`, and a NaN budget makes `Date.now() < deadline` false on the
 * FIRST check, so the script exits "not ready" without ever probing — a failure
 * that looks exactly like an app that never started.
 */
function numericArg(name, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = arg(name, fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    console.error(`::error::--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return value;
}

const HOST = arg("host", "127.0.0.1");
const PORT = numericArg("port", "9323", { max: 65535 });
const WINDOW = arg("window", "main");
const BUDGET_MS = numericArg("timeout-ms", "300000");
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
    // `windowLabel` is not optional here: without it `execute_js` runs in the
    // DEFAULT window, so `--window doc-1` verified that doc-1 exists and then
    // reported main's readiness as doc-1's (audit finding #8). The label check
    // above made that look deliberate.
    const reply = await client.send(
      "execute_js",
      { script: DRIVABLE_SNIPPET, windowLabel: WINDOW },
      10000,
    );
    if (reply.success !== true) return `execute_js not ready: ${reply.error ?? "?"}`;
    return drivableGap(reply.data);
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
    console.log(`app drivable after ${n} attempt(s): window '${WINDOW}' completed its ready handshake`);
    process.exit(0);
  }
  // Report progress occasionally so a stuck run says what it is stuck on
  // rather than going quiet for five minutes.
  if (n === 1 || n % 15 === 0) console.log(`  [${n}] not ready: ${last}`);
  // Sleep only as far as the deadline. An unconditional POLL_MS meant the loop
  // could wake, find the budget spent, and exit — after sleeping past it — so
  // the advertised timeout was a lower bound rather than a bound.
  const remaining = deadline - Date.now();
  if (remaining <= 0) break;
  await new Promise((r) => setTimeout(r, Math.min(POLL_MS, remaining)));
}

console.error(`::error::app never became drivable within ${BUDGET_MS}ms — last: ${last}`);
process.exit(1);
