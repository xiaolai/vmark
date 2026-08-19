#!/usr/bin/env node
/**
 * MCP docs-drift gate (WI-NB9.1) — every action the sidecar tools ship must be
 * documented on the public MCP reference page.
 *
 * The website page `website/guide/mcp-tools.md` is hand-written. A new tool
 * action can ship in the sidecar and never reach the docs — which is how
 * `mcp-tools.md` came to contradict the code (it said cookie capture was a
 * follow-up after it had shipped). This gate reads the ACTION ENUMS out of the
 * sidecar tool sources and fails if any action is not documented as a code span
 * on the reference page.
 *
 * Deliberately checks presence, not full text: a description is prose and drifts
 * legitimately; a shipped-but-entirely-undocumented action is the drift class
 * that misleads users. Measured clean on adoption (every current action is
 * documented), so it ships zero-tolerance with no allowlist.
 *
 * Self-tested by `scripts/check-mcp-docs.test.mjs`.
 *
 * @coordinates-with server/mcp/src/tools/*.ts — the action enums
 * @coordinates-with website/guide/mcp-tools.md — the reference page
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = join(ROOT, "server/mcp/src/tools");
const DOC = join(ROOT, "website/guide/mcp-tools.md");

/** Extract the string literals of the FIRST `action` enum in a tool source. */
export function extractActions(source) {
  // Match `.enum([ ... ])` immediately after an `action:` field declaration.
  const m = source.match(/action:\s*z\s*\n?\s*\.enum\(\[([\s\S]*?)\]\)/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]);
}

/** Every (tool file, action) pair the sidecar ships. */
export function shippedActions(toolsDir = TOOLS_DIR) {
  const out = [];
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(toolsDir, file), "utf8");
    for (const action of extractActions(source)) out.push({ file, action });
  }
  return out;
}

/** Actions NOT documented as a `` `code span` `` on the reference page. */
export function undocumented(actions, docText) {
  return actions.filter(({ action }) => !docText.includes(`\`${action}\``));
}

function main() {
  const actions = shippedActions();
  if (actions.length === 0) {
    console.error("❌ check-mcp-docs: found no tool actions — the extractor is broken.");
    process.exit(1);
  }
  const docText = readFileSync(DOC, "utf8");
  const missing = undocumented(actions, docText);
  if (missing.length > 0) {
    console.error("❌ MCP actions shipped but not documented in website/guide/mcp-tools.md:");
    for (const { file, action } of missing) console.error(`  ${action}  (${file})`);
    console.error("\nDocument each as a `code span` on the reference page.");
    process.exit(1);
  }
  console.error(`✅ MCP docs gate: all ${actions.length} sidecar tool actions are documented.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
