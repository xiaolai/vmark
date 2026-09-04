// @vitest-environment node
// Audit 2026-09-03 round 3 (#87) — the per-tab ledger of COMMITTED navigation ids
// browserTabEvents keeps for itself, so deciding whether a failure names a superseded
// navigation no longer depends on the broker's `latestNavigationId` (and on which of
// the two listeners the runtime happened to call first).
import { describe, expect, it } from "vitest";
import { CommittedNavigations } from "./committedNavigations";

const TAB = "tab-1";

describe("CommittedNavigations", () => {
  it("knows nothing before the first commit: no id is superseded", () => {
    const ledger = new CommittedNavigations();
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(false);
  });

  it("the current commit is not superseded; the commit it replaced is", () => {
    const ledger = new CommittedNavigations();
    ledger.commit(TAB, "nav-1");
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(false);
    ledger.commit(TAB, "nav-2");
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(true);
    expect(ledger.isSuperseded(TAB, "nav-2")).toBe(false);
  });

  // A provisional load that never commits (DNS, TLS, refused connection) fails under
  // an id no commit ever carried. It is the common real failure, and it is CURRENT.
  it("an id that never committed is not superseded — a provisional failure must still show", () => {
    const ledger = new CommittedNavigations();
    ledger.commit(TAB, "nav-1");
    expect(ledger.isSuperseded(TAB, "nav-provisional")).toBe(false);
  });

  // A redirect chain commits every hop under ONE ticket, and a reload re-commits.
  it("re-committing the current id does not supersede it", () => {
    const ledger = new CommittedNavigations();
    ledger.commit(TAB, "nav-1");
    ledger.commit(TAB, "nav-1");
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(false);
    ledger.commit(TAB, "nav-2");
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(true);
  });

  it("tabs are independent", () => {
    const ledger = new CommittedNavigations();
    ledger.commit(TAB, "nav-1");
    ledger.commit(TAB, "nav-2");
    ledger.commit("tab-2", "nav-1");
    expect(ledger.isSuperseded("tab-2", "nav-1")).toBe(false);
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(true);
  });

  it("remembers a bounded number of superseded ids, oldest evicted first", () => {
    const ledger = new CommittedNavigations(2);
    for (const id of ["a", "b", "c", "d"]) ledger.commit(TAB, id);
    expect(ledger.isSuperseded(TAB, "a")).toBe(false); // evicted: as unknown as a fresh id
    expect(ledger.isSuperseded(TAB, "b")).toBe(true);
    expect(ledger.isSuperseded(TAB, "c")).toBe(true);
    expect(ledger.isSuperseded(TAB, "d")).toBe(false);
  });

  it("forget drops one tab and leaves the others alone", () => {
    const ledger = new CommittedNavigations();
    ledger.commit(TAB, "nav-1");
    ledger.commit(TAB, "nav-2");
    ledger.commit("tab-2", "x");
    ledger.commit("tab-2", "y");
    ledger.forget(TAB);
    expect(ledger.isSuperseded(TAB, "nav-1")).toBe(false);
    expect(ledger.isSuperseded("tab-2", "x")).toBe(true);
    expect(() => ledger.forget("never-seen")).not.toThrow();
  });

  it("a tab id named like a prototype property is an ordinary key", () => {
    const ledger = new CommittedNavigations();
    expect(ledger.isSuperseded("constructor", "nav-1")).toBe(false);
    ledger.commit("toString", "nav-1");
    ledger.commit("toString", "nav-2");
    expect(ledger.isSuperseded("toString", "nav-1")).toBe(true);
  });
});
