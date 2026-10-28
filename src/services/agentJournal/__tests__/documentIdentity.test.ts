// @vitest-environment node
// WI-AL1.4 — the per-tab journal state has a declared budget: past it the oldest entries are evicted to bounded tombstones, so an evicted tab's next controlled write is refused instead of stating no parent (no CAS); a fresh basis clears the tombstone; every tab and document gets a window name of its own that is never reused once released; closing a tab drops all of its state and releases each of its window names in the journal (a release that fails is logged, never thrown)
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  JOURNAL_IDENTITY_BUDGET,
  docKeyFor,
  forgetJournalBasis,
  isJournalBasisEvicted,
  journalBasis,
  journalObservedBase,
  rememberJournalBasis,
  rememberPendingSave,
  releaseTabJournal,
  resetJournalBases,
  windowNameFor,
} from "../documentIdentity";
import { agentJournalEpochFake as epochs } from "@/test/agentJournalEpochFake";

beforeEach(() => resetJournalBases());

describe("budget", () => {
  it("evicts the oldest tab state past the budget and remembers that it did", () => {
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET; i++) rememberJournalBasis(`t${i}`, "path:/a.md", `rev-${i}`);
    expect(journalBasis("t0", "path:/a.md")).toBeNull();
    expect(isJournalBasisEvicted("t0", "path:/a.md")).toBe(true);
    expect(journalBasis(`t${JOURNAL_IDENTITY_BUDGET}`, "path:/a.md")).toBe(`rev-${JOURNAL_IDENTITY_BUDGET}`);
    expect(isJournalBasisEvicted("t1", "path:/a.md")).toBe(false);
  });

  it("a fresh basis or pending save clears the tombstone", () => {
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET + 1; i++) rememberPendingSave(`t${i}`, "k", `obs-${i}`);
    expect(isJournalBasisEvicted("t0", "k")).toBe(true);
    rememberJournalBasis("t0", "k", "rev");
    expect(isJournalBasisEvicted("t0", "k")).toBe(false);
    rememberPendingSave("t1", "k", "obs");
    expect(isJournalBasisEvicted("t1", "k")).toBe(false);
    expect(journalObservedBase("t1", "k")).toEqual({ ref: "pending", observation: "obs" });
  });

  it("forgetting the basis (the refused write that rebases) clears the tombstone", () => {
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET; i++) rememberJournalBasis(`t${i}`, "k", "r");
    forgetJournalBasis("t0", "k");
    expect(isJournalBasisEvicted("t0", "k")).toBe(false);
  });

  it("keeps the tombstones themselves bounded", () => {
    for (let i = 0; i < 3 * JOURNAL_IDENTITY_BUDGET; i++) rememberJournalBasis(`t${i}`, "k", "r");
    expect(isJournalBasisEvicted("t0", "k")).toBe(false); // the oldest tombstone aged out
    expect(isJournalBasisEvicted(`t${JOURNAL_IDENTITY_BUDGET + 5}`, "k")).toBe(true);
  });
});

describe("window names", () => {
  it("are stable per tab and document, distinct across tabs, documents and releases", () => {
    const a = windowNameFor("t1", "path:/a.md", "main");
    expect(windowNameFor("t1", "path:/a.md", "main")).toBe(a);
    expect(a?.startsWith("main/t1@")).toBe(true);
    expect(windowNameFor("t2", "path:/a.md", "main")).not.toBe(a);
    expect(windowNameFor("t1", "path:/b.md", "main")).not.toBe(a);
    releaseTabJournal("t1");
    expect(windowNameFor("t1", "path:/a.md", "main")).not.toBe(a);
  });

  it("fit the journal's 512-byte limit for long CJK labels", () => {
    const name = windowNameFor("标签".repeat(40), docKeyFor({ tabId: "x", filePath: "/读书.md" }, "w"), "窗口".repeat(40));
    expect(name).not.toBeNull();
    expect(new TextEncoder().encode(name ?? "").length).toBeLessThanOrEqual(512);
  });
});

describe("releaseTabJournal", () => {
  it("drops every basis of the tab and releases each of its window names", async () => {
    rememberJournalBasis("t1", "path:/a.md", "r1");
    rememberPendingSave("t1", "path:/b.md", "o1");
    rememberJournalBasis("t2", "path:/a.md", "r2");
    const names = [windowNameFor("t1", "path:/a.md", "main"), windowNameFor("t1", "path:/b.md", "main")];
    releaseTabJournal("t1");
    expect(journalBasis("t1", "path:/a.md")).toBeNull();
    expect(journalObservedBase("t1", "path:/b.md")).toBeNull();
    expect(journalBasis("t2", "path:/a.md")).toBe("r2");
    await vi.waitFor(() => expect([...epochs.released].sort()).toEqual([...names].sort()));
  });

  it("is idempotent and logs a release the journal refuses", async () => {
    windowNameFor("t1", "k", "main");
    epochs.releaseWindow.mockRejectedValueOnce(new Error("journal down"));
    expect(() => releaseTabJournal("t1")).not.toThrow();
    expect(() => releaseTabJournal("t1")).not.toThrow();
    await vi.waitFor(() => expect(epochs.releaseWindow).toHaveBeenCalledTimes(1));
  });
});
