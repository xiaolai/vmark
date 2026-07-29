#!/usr/bin/env node
/**
 * Production-bundle smoke test (guards grill C1).
 *
 * Imports from `dist/` (NOT src via the Vitest alias) and proves the bundled
 * markdown-plugins boundary resolves at runtime: boots the KB server, performs
 * the nonce→cookie handshake, and renders a note exercising alerts, wiki-links,
 * and highlight. Run after `build`; wired into the project gate.
 */
import { startKbServer } from "../dist/index.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond, msg) {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
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
  const mint = await fetch(`${srv.url}/__mint`, {
    headers: { authorization: "Bearer smoke-token" },
  });
  const { nonce } = await mint.json();
  const boot = await fetch(`${srv.url}/__auth?t=${nonce}`, { redirect: "manual" });
  const cookie =
    "vmark_cs_session=" +
    /vmark_cs_session=([^;]+)/.exec(boot.headers.get("set-cookie"))[1];
  const res = await fetch(`${srv.url}/note/A.md`, { headers: { cookie } });
  const html = await res.text();

  assert(res.status === 200, `note render status ${res.status}`);
  assert(html.includes("markdown-alert-note"), "alert not rendered from dist");
  assert(html.includes("/note/B.md"), "wiki-link not resolved from dist");
  assert(html.includes("<mark>mark</mark>"), "highlight not rendered from dist");
  assert(html.includes("katex"), "math not rendered from dist");

  console.log("dist smoke OK — bundled markdown boundary resolves at runtime");
} finally {
  if (srv) await srv.close();
  await fs.rm(root, { recursive: true, force: true });
}
