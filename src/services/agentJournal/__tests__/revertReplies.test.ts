// @vitest-environment node
// WI-AL2.2b — a revert prepare's two replies are read losslessly or refused whole: an applied revert's patch needs safe non-negative UTF-16 offsets with from <= to, a string insert (empty allowed) and a sha256 postimage hash; a decision names conflicted or revertFoundBase with decimal reviewGen and generation and a nullable baseline and head; a field either reply does not define, or one it lacks, is refused; anything else throws JOURNAL_UNAVAILABLE as malformed
import { describe, expect, it } from "vitest";

import { JournalRefusal } from "../journalRefusal";
import { parseRevertDecided, parseRevertPrepared } from "../revertReplies";

const CMD = "agent_journal_revert_prepare";
const PREPARED = {
  doc: "d",
  txn: "t",
  revision: "r",
  generation: "9007199254740993",
  baseline: null,
  hunk: "h",
  reviewGen: "7",
  from: 3,
  to: 3,
  insert: "",
  postimageHash: `sha256-${"0".repeat(64)}`,
};
const DECIDED = { doc: "d", hunk: "h", action: "conflicted", reviewGen: "1", generation: "2", baseline: null, head: null };

function refused(fn: () => unknown): JournalRefusal {
  try {
    fn();
  } catch (error) {
    if (error instanceof JournalRefusal) return error;
  }
  throw new Error("expected a JournalRefusal");
}

describe("parseRevertPrepared", () => {
  it("reads an empty insertion at one offset unchanged", () => {
    expect(parseRevertPrepared(CMD, PREPARED)).toEqual(PREPARED);
  });

  it.each([
    ["from after to", { from: 4, to: 3 }],
    ["a negative offset", { from: -1 }],
    ["an unsafe offset", { to: 2 ** 53 }],
    ["a fractional offset", { to: 3.5 }],
    ["a decimal-string offset", { to: "3" }],
    ["a non-string insert", { insert: null }],
    ["a bare hex hash", { postimageHash: "0".repeat(64) }],
    ["an uppercase hash", { postimageHash: `sha256-${"A".repeat(64)}` }],
    ["a numeric reviewGen", { reviewGen: 7 }],
    ["a missing hunk", { hunk: undefined }],
    ["a missing txn", { txn: undefined }],
    ["a field it does not define", { capture: "c" }],
  ])("refuses %s", (_name, patch) => {
    expect(refused(() => parseRevertPrepared(CMD, { ...PREPARED, ...patch })).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });
});

describe("parseRevertDecided", () => {
  it.each(["conflicted", "revertFoundBase"])("reads a %s decision", (action) => {
    const reply = { ...DECIDED, action, baseline: "b", head: "b" };
    expect(parseRevertDecided(CMD, reply)).toEqual(reply);
  });

  it.each([
    ["another action", { action: "keep" }],
    ["a numeric generation", { generation: 2 }],
    ["a missing head", { head: undefined }],
    ["an empty doc", { doc: "" }],
    ["a field it does not define", { txn: "t" }],
  ])("refuses %s", (_name, patch) => {
    expect(refused(() => parseRevertDecided(CMD, { ...DECIDED, ...patch })).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });

  it.each([
    ["prepared", PREPARED, parseRevertPrepared],
    ["decided", DECIDED, parseRevertDecided],
  ] as const)("refuses a %s reply without one of its fields", (_name, reply, parse) => {
    for (const key of Object.keys(reply)) {
      const short: Record<string, unknown> = { ...reply };
      delete short[key];
      expect(refused(() => parse(CMD, short)).journalCode, key).toBe("JOURNAL_UNAVAILABLE");
    }
  });

  it("refuses a non-object", () => {
    expect(refused(() => parseRevertDecided(CMD, null)).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });
});
