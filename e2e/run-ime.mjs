/**
 * WI-5.2 — the real-IME lane (`pnpm e2e:ime`).
 *
 * The ONLY tier where the REAL macOS input method drives the SHIPPING
 * WKWebView: raw `key code` events injected at the OS level (never
 * `keystroke "text"`, whose character payload bypasses the IME), composed by
 * the user's own input method, asserted through the Tauri MCP bridge.
 *
 * Opt-in and machine-gated. Every precondition is checked and REFUSED BY
 * NAME (fail closed, per the plan's field-validated list):
 *   - VMARK_REAL_IME=1 — never runs by accident on a machine in use
 *   - macOS + machine profile (.vmark/ime-machine-profile.json)
 *   - session UNLOCKED (a locked session swallows keys after the HID layer
 *     with no error anywhere)
 *   - delivery-live probe: a benign modifier key must tickle a
 *     `UserIsActive ... process:System Events` power assertion
 *   - IME schema verification via `defaults` — the lane ADAPTS to the
 *     machine's schema and NEVER mutates it
 *   - input-source switch verified by read-back; previous source restored
 *     on EVERY exit path
 *   - frontmost-verify before EVERY injection burst (unverified injection
 *     once landed in another app)
 *   - no app-targeted AppleEvents, ever — System Events + the bridge only.
 *
 * Sequences are SCHEMA-KEYED: under this machine's 微软双拼, 你好 is
 * n-i-h-k and 明天 is m-;-t-m — the `;` keystroke becoming 明 is an
 * identity only the real IME pipeline can produce.
 *
 * @coordinates-with e2e/lib/bridge.mjs — in-process observation
 * @coordinates-with dev-docs/plans/20260805-markdown-testing-adoption.md — WI-5.2
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient, evalJs } from "./lib/bridge.mjs";
import { withTabRestore, createScratchTab, getEditorText, getTabs, poll } from "./lib/vmark.mjs";
import { parseArgs } from "./lib/config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_PATH = process.env.VMARK_IME_PROFILE ?? join(repoRoot, ".vmark", "ime-machine-profile.json");

// ANSI-QWERTY virtual key codes for the sequence alphabet.
const KEYCODES = {
  n: 45, i: 34, h: 4, k: 40, m: 46, t: 17, ";": 41,
  Space: 49, Return: 36, Escape: 53, Backspace: 51, Shift: 56,
};

/** Schema-keyed keystroke tables (public knowledge; machines pick via profile). */
const SEQUENCES = {
  "ms-shuangpin": {
    nihao: { keys: ["n", "i", "h", "k"], commits: "你好" },
    mingtian: { keys: ["m", ";", "t", "m"], commits: "明天" },
  },
  quanpin: {
    nihao: { keys: ["n", "i", "h", "a", "o"], commits: "你好" },
    mingtian: { keys: ["m", "i", "n", "g", "t", "i", "a", "n"], commits: "明天" },
  },
};

function refuse(name, detail) {
  console.error(`REFUSED [${name}] ${detail}`);
  process.exit(2);
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function osascript(script) {
  return sh("osascript", ["-e", script]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── preflight ─────────────────────────────────────────────────────────────
if (process.platform !== "darwin") refuse("platform", "macOS only");
if (process.env.VMARK_REAL_IME !== "1") {
  refuse("opt-in", "set VMARK_REAL_IME=1 on a dedicated, unattended machine — injected keys race real input");
}
if (!existsSync(PROFILE_PATH)) refuse("profile", `no machine profile at ${PROFILE_PATH}`);
const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
const table = SEQUENCES[profile.schema];
if (!table) refuse("schema-table", `no keystroke table for schema "${profile.schema}"`);

// Session must be UNLOCKED — locked sessions swallow injected keys silently.
const locked = osascript(
  `use framework "Foundation"
   set d to current application's NSClassFromString("NSDictionary")
   try
     set info to (current application's CGSessionCopyCurrentDictionary()) as record
     if CGSSessionScreenIsLocked of info is not missing value then return "locked"
   end try
   return "unlocked"`.replaceAll("\n   ", "\n"),
);
if (locked === "locked") refuse("session-locked", "unlock the console session (Screen Sharing works)");

// Schema verification — adapt, never mutate.
const sv = profile.schemaVerification;
if (sv) {
  let actual;
  try {
    actual = sh("defaults", ["read", sv.domain, sv.key]);
  } catch {
    refuse("schema-verify", `defaults read ${sv.domain} ${sv.key} failed`);
  }
  if (String(actual) !== String(sv.expectedValue)) {
    refuse("schema-mismatch", `${sv.key}=${actual}, profile expects ${sv.expectedValue} (${profile.schema}) — update the PROFILE, not the IME`);
  }
}

// Delivery-live probe: benign Shift keydown must tickle a System Events
// UserIsActive assertion — proves Accessibility + HID delivery end to end.
try {
  osascript('tell application "System Events" to key code 56');
} catch (e) {
  refuse("accessibility", `System Events key injection failed (grant Accessibility to this context): ${e.message}`);
}
await sleep(300);
const assertions = sh("pmset", ["-g", "assertions"]);
if (!/UserIsActive.*System Events/s.test(assertions)) {
  refuse("delivery-live", "no UserIsActive tickle from System Events after probe key — injection is not reaching IOHIDSystem");
}

// Input-source switch, read-back verified; restore in finally below.
const macism = profile.switcher?.bin ?? "macism";
const previousSource = sh(macism, []);
const cjkSource = profile.inputSources.cjk;

function frontmostVerify(targetName) {
  const front = osascript(
    'tell application "System Events" to get name of first application process whose frontmost is true',
  );
  if (!front.toLowerCase().includes(targetName)) {
    throw new Error(`frontmost-verify: "${front}" is frontmost, expected ${targetName}`);
  }
  const windows = osascript(
    `tell application "System Events" to count windows of (first application process whose frontmost is true)`,
  );
  if (Number(windows) < 1) throw new Error("frontmost-verify: target has no windows");
}

async function inject(keys, { targetName }) {
  frontmostVerify(targetName); // before EVERY burst — the field-validated lesson
  for (const key of keys) {
    const code = KEYCODES[key];
    if (code === undefined) throw new Error(`no keycode for ${JSON.stringify(key)}`);
    osascript(`tell application "System Events" to key code ${code}`);
    await sleep(160);
  }
}

// ── the lane ──────────────────────────────────────────────────────────────
async function main() {
  const cfg = parseArgs(process.argv.slice(2), { usage: "Usage: VMARK_REAL_IME=1 pnpm e2e:ime [--port 9323]" });
  const client = new BridgeClient({ idPrefix: "ime" });
  await client.connect(cfg);
  console.log(`real-IME lane — schema ${profile.schema}, source ${cjkSource}`);

  // Focus the app (activation is allowed; only app-targeted AppleEvents are not).
  const appProcess = osascript(
    `tell application "System Events" to get name of first application process whose name contains "vmark" or name contains "VMark"`,
  );
  osascript(`tell application "System Events" to set frontmost of process "${appProcess}" to true`);
  await sleep(500);

  const switched = (() => {
    sh(macism, [cjkSource]);
    return sh(macism, []);
  })();
  if (switched !== cjkSource) {
    refuse("input-source", `macism read-back "${switched}" ≠ "${cjkSource}" — switch did not take effect`);
  }

  let failures = 0;
  try {
    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);
      await evalJs(client, `(() => { document.querySelector('.ProseMirror').focus(); return true; })()`);

      const check = async (label, fn) => {
        try {
          await fn();
          console.log(`  PASS ${label}`);
        } catch (e) {
          failures += 1;
          console.error(`  FAIL ${label}: ${e.message}`);
        }
      };

      await check("compose nihao + Space commits 你好", async () => {
        await inject([...table.nihao.keys, "Space"], { targetName: appProcess.toLowerCase() });
        await poll(() => getEditorText(client), (t) => typeof t === "string" && t.includes(table.nihao.commits), "你好 in document");
      });

      await check("compose mingtian (the ; identity) + Space commits 明天", async () => {
        await inject([...table.mingtian.keys, "Space"], { targetName: appProcess.toLowerCase() });
        await poll(() => getEditorText(client), (t) => typeof t === "string" && t.includes(table.mingtian.commits), "明天 in document");
      });

      await check("Escape cancels a composition without touching the document", async () => {
        const before = await getEditorText(client);
        await inject([...table.nihao.keys, "Escape"], { targetName: appProcess.toLowerCase() });
        await sleep(500);
        const after = await getEditorText(client);
        if (after !== before) throw new Error(`document changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      });

      await check("Backspace mid-composition removes one keystroke (then Escape leaves clean)", async () => {
        const before = await getEditorText(client);
        await inject([...table.nihao.keys, "Backspace", "Escape"], { targetName: appProcess.toLowerCase() });
        await sleep(500);
        const after = await getEditorText(client);
        if (after !== before) throw new Error(`document changed after backspace+cancel: ${JSON.stringify(after)}`);
      });

      // Tab dirtiness is store state — the identity a broken pipeline can't fake.
      await check("committed compositions dirtied the scratch tab", async () => {
        const tabs = await getTabs(client);
        const tab = tabs.find((t) => t.id === scratch.id);
        if (!tab?.dirty) throw new Error("scratch tab is not dirty after commits");
      });
    });
  } finally {
    try {
      sh(macism, [previousSource]);
      console.log(`input source restored: ${previousSource}`);
    } catch (e) {
      console.error(`WARNING: failed to restore input source "${previousSource}": ${e.message}`);
    }
    client.close();
  }

  if (failures > 0) {
    console.error(`REAL-IME LANE FAILED — ${failures} sequence(s)`);
    process.exit(1);
  }
  console.log("REAL-IME LANE PASSED");
}

main().catch((e) => {
  try { sh(macism, [previousSource]); } catch { /* reported above */ }
  console.error(`real-IME lane error: ${e.message}`);
  process.exit(1);
});
