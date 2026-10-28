#!/usr/bin/env node
/**
 * Receipt fixtures change gate: every commit that touches
 * `src-tauri/src/agent_journal/fixtures/` must cite a plan rule (`R64`, …) in
 * its message.
 *
 * Those fixtures are the frozen receipt bytes the Rust writer and the
 * TypeScript client are both pinned to: a receipt's digest is SHA-256 over the
 * exact payload, so re-generating a fixture to make a failing test pass
 * silently moves a persisted contract. Requiring the rule that justifies the
 * change makes that move a reviewed decision instead of a side effect.
 *
 * A rule reference is a standalone token `R<digits>`: `PR64` and `R64a` cite
 * nothing. A shallow clone fails closed, since it cannot see the commits it
 * must judge.
 *
 * Usage: node scripts/check-receipt-fixtures.mjs   (run from the repository root)
 * Exit codes: 0 clean · 1 a fixture commit cites no rule, or history is unreadable.
 *
 * @coordinates-with src-tauri/src/agent_journal/receipt_fixtures.test.rs — the Rust half of the pin
 * @coordinates-with src/services/agentJournal/__tests__/receiptFixtures.test.ts — the TypeScript half
 */
import { spawnSync } from "node:child_process";

const FIXTURES = "src-tauri/src/agent_journal/fixtures/";
const RULE = /(?<![A-Za-z0-9])R\d+(?![A-Za-z0-9])/;

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`check-receipt-fixtures: git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    process.exit(1);
  }
  return r.stdout;
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
  console.error("check-receipt-fixtures: this is a shallow clone; fetch full history (fetch-depth: 0) so every fixture commit can be checked.");
  process.exit(1);
}

const log = git(["log", "--format=%H%x00%B%x1e", "--", FIXTURES]);
const offenders = log
  .split("\x1e")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [sha, message = ""] = entry.split("\x00");
    return { sha, message };
  })
  .filter(({ message }) => !RULE.test(message));

if (offenders.length > 0) {
  console.error(`check-receipt-fixtures: ${offenders.length} commit(s) change ${FIXTURES} without citing a plan rule (R<n>):`);
  for (const { sha, message } of offenders) console.error(`  ${sha.slice(0, 12)} ${message.split("\n")[0]}`);
  process.exit(1);
}
