#!/usr/bin/env node
/**
 * Production-bundle smoke test (guards grill C1).
 *
 * Imports from `dist/` (NOT src via the Vitest alias) and proves the bundled
 * markdown-plugins boundary resolves at runtime: boots the KB server, performs
 * the nonce→cookie handshake, and renders a note exercising alerts, wiki-links,
 * and highlight. Also spawns the built CLI wrapper (the one seam unit tests
 * cannot see). Run after `build`; wired into the project gate.
 */
import { startKbServer } from "../dist/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

function assert(cond, msg) {
  if (!cond) {
    // Throw (not process.exit) so the outer finally still closes the server
    // and removes the temporary root before the process fails.
    throw new Error(`SMOKE FAIL: ${msg}`);
  }
}

// Deadlines everywhere: a hung handshake must fail the gate, not wedge CI.
const deadline = () => AbortSignal.timeout(10_000);

/** Boot handshake + render: prove the bundled markdown boundary resolves. */
async function smokeServerBundle(srv) {
  const mint = await fetch(`${srv.url}/__mint`, {
    headers: { authorization: "Bearer smoke-token" },
    signal: deadline(),
  });
  assert(mint.status === 200, `mint status ${mint.status}`);
  const { nonce } = await mint.json();
  assert(typeof nonce === "string" && nonce.length > 0, "mint returned no nonce");

  const boot = await fetch(`${srv.url}/__auth?t=${nonce}`, {
    redirect: "manual",
    signal: deadline(),
  });
  const setCookie = boot.headers.get("set-cookie") ?? "";
  const session = /vmark_cs_session=([^;]+)/.exec(setCookie);
  assert(session, `auth set no session cookie (status ${boot.status})`);
  const cookie = "vmark_cs_session=" + session[1];

  const res = await fetch(`${srv.url}/note/A.md`, { headers: { cookie }, signal: deadline() });
  const html = await res.text();
  assert(res.status === 200, `note render status ${res.status}`);
  assert(html.includes("markdown-alert-note"), "alert not rendered from dist");
  assert(html.includes("/note/B.md"), "wiki-link not resolved from dist");
  assert(html.includes("<mark>mark</mark>"), "highlight not rendered from dist");
  assert(html.includes("katex"), "math not rendered from dist");

  console.log("dist smoke OK — bundled markdown boundary resolves at runtime");
}

/**
 * Process-level CLI wrapper smoke (WI-8): cliMain.ts is unit-tested with
 * injected deps; these two spawns prove the THIN WRAPPER (dist/cli.js)
 * actually binds process/env/server.
 */
async function smokeCliWrapper() {
  const run = promisify(execFile);
  const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  // Scrub the CS env vars: with them inherited, the missing-args child would
  // START A SERVER (env fallback) and hang instead of exiting 2. Timeouts
  // bound both spawns for the same no-wedge reason as the fetches above.
  const childEnv = { ...process.env };
  delete childEnv.VMARK_CS_ROOT;
  delete childEnv.VMARK_CS_TOKEN;
  const spawnOpts = { env: childEnv, timeout: 15_000 };

  const version = await run(process.execPath, [cliPath, "--version"], spawnOpts);
  assert(/^\d+\.\d+\.\d+\s*$/.test(version.stdout), `--version output: ${version.stdout}`);

  const missing = await run(process.execPath, [cliPath], spawnOpts).catch((err) => err);
  assert(missing.code === 2, `missing-args exit code ${missing.code}`);
  assert(
    String(missing.stderr).includes("--root and --token"),
    "missing-args error message absent"
  );

  console.log("cli wrapper smoke OK — --version and fail-fast arg validation");
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-cs-smoke-"));
let srv;
try {
  await fs.writeFile(
    path.join(root, "A.md"),
    "# Hi\n\n> [!NOTE]\n> note body\n\n[[B]] and ==mark== with $x^2$"
  );
  await fs.writeFile(path.join(root, "B.md"), "b");

  srv = await startKbServer({ root, bootstrapToken: "smoke-token" });
  await smokeServerBundle(srv);
  await smokeCliWrapper();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  // Nested so a rejected close() still lets the temp root be removed
  // (and still fails the process loudly).
  try {
    if (srv) await srv.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
