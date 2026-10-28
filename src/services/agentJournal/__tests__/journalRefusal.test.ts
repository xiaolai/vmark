// @vitest-environment node
// WI-AL2.2f — the request-protocol tokens STALE_REQUEST (an ended, fenced or stale request) and STALE_PAGE (a commit or abort whose page registration is no longer live) are journal refusals the client reads from detail.journalCode, not unknown answers collapsed into JOURNAL_UNAVAILABLE
import { describe, it, expect } from "vitest";
import { toJournalRefusal } from "../journalRefusal";

describe("toJournalRefusal — request-protocol tokens", () => {
  it.each(["STALE_REQUEST", "STALE_PAGE"])("reads %s as its own journal code", (journalCode) => {
    const r = toJournalRefusal({ code: "conflict", message: `${journalCode}: m`, detail: { journalCode } });
    expect(r.journalCode).toBe(journalCode);
  });
});
