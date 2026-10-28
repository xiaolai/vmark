// @vitest-environment node
// WI-AL2.2g — the request answer is validated at the IPC boundary: a prepare's or abandon's refusal becomes notAdmitted, terminalPending, terminal, abandoned or uncertain field by field, and every missing, mistyped or mismatched field (uncertain absent, "false" or null; a wrong id or digest; an unknown state; terminalPending without a valid terminal; status prepared; discarded or resolved without by; no echo at all; a code that does not match its state) is uncertain, never clean
import { describe, it, expect } from "vitest";

import { settleRequestRefusal } from "../journalSettlement";

const ID = "6f1c2c56-6d51-4c3e-9c61-1f7c4b3b9a10";
const DIGEST = "a".repeat(64);
const EXPECT = { requestId: ID, digest: DIGEST };
const BY = "01J0000000000000000000TXN1";

/** A CommandError-shaped rejection with `detail`. */
function rejection(detail: Record<string, unknown>): unknown {
  return { code: "conflict", message: "refused", detail };
}

function answer(
  journalCode: string,
  uncertain: unknown,
  request: Record<string, unknown> | undefined,
): unknown {
  const detail: Record<string, unknown> = { journalCode };
  if (uncertain !== undefined) detail.uncertain = uncertain;
  if (request !== undefined) detail.request = { id: ID, digest: DIGEST, ...request };
  return rejection(detail);
}

describe("settleRequestRefusal — valid answers", () => {
  it("a clean notAdmitted keeps its cause's code", () => {
    const out = settleRequestRefusal(answer("STALE_PARENT", false, { state: "notAdmitted" }), EXPECT);
    expect(out).toEqual({ kind: "notAdmitted" });
  });

  it.each(["committed", "aborted", "uncommitted"])("terminalPending %s", (terminal) => {
    const out = settleRequestRefusal(answer("STALE_REQUEST", false, { state: "terminalPending", terminal }), EXPECT);
    expect(out).toEqual({ kind: "terminalPending", terminal });
  });

  it.each(["committed", "aborted", "uncommitted"])("terminal %s", (status) => {
    const out = settleRequestRefusal(answer("STALE_REQUEST", false, { state: "terminal", status }), EXPECT);
    expect(out).toEqual({ kind: "terminal", status, by: null });
  });

  it.each(["discarded", "resolved"])("terminal %s names its successor", (status) => {
    const out = settleRequestRefusal(answer("STALE_REQUEST", false, { state: "terminal", status, by: BY }), EXPECT);
    expect(out).toEqual({ kind: "terminal", status, by: BY });
  });

  it("abandoned", () => {
    const out = settleRequestRefusal(answer("STALE_REQUEST", false, { state: "abandoned" }), EXPECT);
    expect(out).toEqual({ kind: "abandoned" });
  });

  it.each([
    ["inFlight", "JOURNAL_BUSY"],
    ["staleIncarnation", "STALE_REQUEST"],
    ["staleGeneration", "STALE_REQUEST"],
    ["conflict", "INVALID_REQUEST"],
    ["unavailable", "JOURNAL_DEGRADED"],
  ])("%s is uncertain with its own cause", (state, code) => {
    const out = settleRequestRefusal(answer(code, true, { state }), EXPECT);
    expect(out).toEqual({ kind: "uncertain", cause: state });
  });

  it("an indeterminate admission (no request named) is uncertain", () => {
    const out = settleRequestRefusal(
      rejection({ journalCode: "JOURNAL_IO", indeterminate: true, uncertain: true }),
      EXPECT,
    );
    expect(out).toMatchObject({ kind: "uncertain" });
  });
});

describe("settleRequestRefusal — every malformed answer is uncertain", () => {
  const clean = { state: "notAdmitted" };
  it.each<[string, unknown]>([
    ["uncertain missing", answer("STALE_PARENT", undefined, clean)],
    ["uncertain is the string false", answer("STALE_PARENT", "false", clean)],
    ["uncertain is null", answer("STALE_PARENT", null, clean)],
    ["notAdmitted marked uncertain", answer("STALE_PARENT", true, clean)],
    ["a wrong request id", rejection({ journalCode: "STALE_PARENT", uncertain: false, request: { id: "x", digest: DIGEST, state: "notAdmitted" } })],
    ["a wrong digest", rejection({ journalCode: "STALE_PARENT", uncertain: false, request: { id: ID, digest: "b".repeat(64), state: "notAdmitted" } })],
    ["an unknown state", answer("STALE_REQUEST", false, { state: "gone" })],
    ["terminalPending without terminal", answer("STALE_REQUEST", false, { state: "terminalPending" })],
    ["terminalPending discarded", answer("STALE_REQUEST", false, { state: "terminalPending", terminal: "discarded" })],
    ["terminal status prepared", answer("STALE_REQUEST", false, { state: "terminal", status: "prepared" })],
    ["terminal without status", answer("STALE_REQUEST", false, { state: "terminal" })],
    ["discarded without by", answer("STALE_REQUEST", false, { state: "terminal", status: "discarded" })],
    ["resolved without by", answer("STALE_REQUEST", false, { state: "terminal", status: "resolved" })],
    ["no echo at all", rejection({ journalCode: "STALE_PARENT", uncertain: false })],
    ["no detail at all", { code: "conflict", message: "refused" }],
    ["a transport string", "IPC failed"],
    ["an abandoned answer marked uncertain", answer("STALE_REQUEST", true, { state: "abandoned" })],
    ["an inFlight answer marked clean", answer("JOURNAL_BUSY", false, { state: "inFlight" })],
    ["a terminal under the wrong code", answer("JOURNAL_BUSY", false, { state: "terminal", status: "committed" })],
    ["an unknown journal code", answer("NOT_A_CODE", false, clean)],
  ])("%s", (_label, error) => {
    expect(settleRequestRefusal(error, EXPECT)).toMatchObject({ kind: "uncertain" });
  });
});
