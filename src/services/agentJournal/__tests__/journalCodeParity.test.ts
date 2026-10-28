// @vitest-environment node
// WI-AL2.2g — every Rust journal refusal code is a TypeScript journal code: the codes are read from errors.rs's code() arms, answer.rs's RequestState::code arms and the journalCode literals in the journal's production Rust, so a code added on one side fails here until the other side has it; the only TypeScript-only code is the client-raised JOURNAL_TIMEOUT. AMBIGUOUS_REVERT round-trips with its hunk and block; its block carries a real Rust break reason, the literal the Rust round-trip test pins; WI-AL2.2e — REVERT_REFUSED round-trips with its hunk and its reason (conflicted or reapply), an unknown reason read as none
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { JOURNAL_CODES, toJournalRefusal } from "../journalRefusal";

const ROOT = join(import.meta.dirname, "../../../..");
const JOURNAL = join(ROOT, "src-tauri/src/agent_journal");

/** The string literals returned by the match arms of `fn <name>` in `source`. */
function armCodes(source: string, fnHeader: string): string[] {
  const start = source.indexOf(fnHeader);
  expect(start, `${fnHeader} not found`).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf("\n    }\n", start));
  return [...body.matchAll(/=>\s*"([A-Z_]+)"/g)].map((m) => m[1]);
}

/** Every production `.rs` file under the journal module. */
function productionRust(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return productionRust(path);
    return name.endsWith(".rs") && !name.endsWith(".test.rs") && !name.includes("tests") ? [path] : [];
  });
}

function rustCodes(): Set<string> {
  const errors = readFileSync(join(JOURNAL, "errors.rs"), "utf8");
  const answer = readFileSync(join(JOURNAL, "admission/answer.rs"), "utf8");
  const codes = new Set([
    ...armCodes(errors, "pub fn code(&self) -> &'static str"),
    ...armCodes(answer, "pub fn code(&self) -> &'static str"),
  ]);
  for (const file of productionRust(JOURNAL)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/"journalCode":\s*"([A-Z_]+)"/g)) codes.add(m[1]);
  }
  return codes;
}

describe("journal code parity", () => {
  it("every Rust journal refusal code is a TypeScript journal code", () => {
    const rust = rustCodes();
    expect(readFileSync(join(JOURNAL, "refusal.rs"), "utf8")).toContain('"journalCode": "JOURNAL_UNAVAILABLE"');
    expect(rust.size).toBeGreaterThan(10);
    const codes: readonly string[] = JOURNAL_CODES;
    expect(codes).toContain("AMBIGUOUS_REVERT");
    expect([...rust].filter((c) => !codes.includes(c))).toEqual([]);
    expect(codes.filter((c) => !rust.has(c))).toEqual(["JOURNAL_TIMEOUT"]);
  });

  it("AMBIGUOUS_REVERT round-trips with its hunk and block", () => {
    // The detail literals `ambiguous_revert_detail_is_what_the_client_reads` pins on the Rust side.
    const block = { reason: "snapshotOnly", origin: "window-main" };
    const r = toJournalRefusal({
      code: "conflict",
      message: "AMBIGUOUS_REVERT: …",
      detail: { journalCode: "AMBIGUOUS_REVERT", hunk: "h-1", block },
    });
    expect(r.journalCode).toBe("AMBIGUOUS_REVERT");
    expect(r.hunk).toBe("h-1");
    expect(r.block).toEqual(block);
    const unblocked = toJournalRefusal({
      code: "conflict",
      message: "m",
      detail: { journalCode: "AMBIGUOUS_REVERT", hunk: "h-1", block: null },
    });
    expect(unblocked.block).toBeNull();
  });

  it.each(["conflicted", "reapply"] as const)("REVERT_REFUSED round-trips with its hunk and reason %s", (reason) => {
    // The detail literals `revert_refused_detail_is_what_the_client_reads` pins on the Rust side.
    const r = toJournalRefusal({ code: "conflict", message: "m", detail: { journalCode: "REVERT_REFUSED", hunk: "h-1", reason } });
    expect([r.journalCode, r.hunk, r.revertReason]).toEqual(["REVERT_REFUSED", "h-1", reason]);
  });

  it("a REVERT_REFUSED reason the client does not know is read as none", () => {
    const r = toJournalRefusal({ code: "conflict", message: "m", detail: { journalCode: "REVERT_REFUSED", hunk: "h-1", reason: "later" } });
    expect([r.journalCode, r.revertReason]).toEqual(["REVERT_REFUSED", null]);
  });

  it("an indeterminate admission is read as uncertain", () => {
    const r = toJournalRefusal({
      code: "io",
      message: "JOURNAL_IO: …",
      detail: { journalCode: "JOURNAL_IO", indeterminate: true, uncertain: true },
    });
    expect(r).toMatchObject({ journalCode: "JOURNAL_IO", uncertain: true });
  });
});
