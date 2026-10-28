// @vitest-environment node
// Journal identity lifetimes: the budget never evicts an entry whose save is outstanding or in flight (the save behind it must still chain on it), nor the redirect a moved save still reports back through, and a tab's journal state ends when the tab closes — a save capture or Save As bind still in flight then, answering late, writes nothing back, even when the same tab id was reopened meanwhile
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { useDocumentStore } from "@/stores/documentStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import {
  JOURNAL_IDENTITY_BUDGET,
  admitOutstandingSave,
  carryJournalBasis,
  clearOutstandingSaveBase,
  finishOutstandingSave,
  isJournalBasisEvicted,
  isJournalTabLive,
  journalBasis,
  journalKeyNow,
  journalObservedBase,
  journalTabLife,
  outstandingSaveBase,
  rememberJournalBasis,
  releaseTabJournal,
  resetJournalBases,
  setOutstandingSaveBase,
  windowNameFor,
} from "../documentIdentity";
import type { JournalObservedRef } from "../journalClient";
import { beginJournalSave } from "../saveJournal";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";

const fill = (from: number, count: number) => {
  for (let i = from; i < from + count; i++) rememberJournalBasis(`t${i}`, "k", "r");
};

beforeEach(() => {
  resetJournalBases();
  useDocumentStore.setState({ documents: {} });
});
afterEach(() => resetUnsavedProvenanceSources());

describe("eviction spares entries with saves in flight", () => {
  it("keeps a moved save's redirect past the redirect budget, so its finish reaches where it moved", () => {
    expect(admitOutstandingSave("s", "path:/a.md", 1)).toBe(true);
    carryJournalBasis("s", "path:/a.md", "path:/b.md");
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET; i++) carryJournalBasis(`m${i}`, "k", "k2");
    expect(journalKeyNow("s", "path:/a.md")).toBe("path:/b.md");
    finishOutstandingSave("s", "path:/a.md");
    expect(admitOutstandingSave("s", "path:/b.md", 1)).toBe(true);
  });

  it("evicts an idle redirect at the redirect budget", () => {
    carryJournalBasis("idle", "path:/a.md", "path:/b.md");
    for (let i = 0; i < JOURNAL_IDENTITY_BUDGET; i++) carryJournalBasis(`m${i}`, "k", "k2");
    expect(journalKeyNow("idle", "path:/a.md")).toBe("path:/a.md");
  });

  it("keeps an outstanding save's chain and evicts the next idle entry instead", () => {
    const chain = new Promise<JournalObservedRef | null>(() => {});
    expect(admitOutstandingSave("busy", "k", 8)).toBe(true);
    windowNameFor("busy", "k", "main");
    setOutstandingSaveBase("busy", "k", chain);
    fill(0, JOURNAL_IDENTITY_BUDGET);
    expect(outstandingSaveBase("busy", "k")).toBe(chain);
    expect(isJournalBasisEvicted("busy", "k")).toBe(false);
    expect(isJournalBasisEvicted("t0", "k")).toBe(true);
    // Once the save finishes, the entry is idle and the budget trims it next.
    finishOutstandingSave("busy", "k");
    clearOutstandingSaveBase("busy", "k", chain);
    fill(JOURNAL_IDENTITY_BUDGET, 1);
    expect(isJournalBasisEvicted("busy", "k")).toBe(true);
  });

  it("keeps an admitted save's entry before its chain is linked", () => {
    expect(admitOutstandingSave("busy", "k", 8)).toBe(true);
    windowNameFor("busy", "k", "main");
    fill(0, JOURNAL_IDENTITY_BUDGET);
    expect(isJournalBasisEvicted("busy", "k")).toBe(false);
  });
});

describe("the budget refuses new state once every entry is held by a save", () => {
  const holdAll = () => {
    for (let i = 0; i < JOURNAL_IDENTITY_BUDGET; i++) expect(admitOutstandingSave(`h${i}`, "k", 8)).toBe(true);
  };

  it("refuses a new entry's save, while an entry already held still admits more", () => {
    holdAll();
    expect(admitOutstandingSave("over", "k", 8)).toBe(false);
    expect(admitOutstandingSave("h0", "k", 8)).toBe(true);
    // One finishes: its entry is idle again, so a new one fits.
    finishOutstandingSave("h1", "k");
    expect(admitOutstandingSave("over", "k", 8)).toBe(true);
  });

  it("refuses a new entry's basis: it is not kept, and its next write rebases", () => {
    holdAll();
    rememberJournalBasis("idle", "k", "r1");
    expect(journalBasis("idle", "k")).toBeNull();
    expect(isJournalBasisEvicted("idle", "k")).toBe(true);
    expect(journalBasis("h0", "k")).toBeNull();
    expect(isJournalBasisEvicted("h0", "k")).toBe(false);
  });

  it("a save refused for the budget is reported not recorded and captures nothing", async () => {
    holdAll();
    useDocumentStore.getState().initDocument("over", "x", "/over.md");
    const out = await beginJournalSave("over", "/over.md", "x", { saveType: "manual" }).record();
    expect(out).toEqual({ journaled: "no", revision: null, reason: "JOURNAL_DEGRADED" });
    expect(agentJournalFake.captureSaveToJournal).not.toHaveBeenCalled();
  });
});

describe("tab lifecycle", () => {
  it("a token stands until the tab closes, and a reopened tab gets a new one", () => {
    const first = journalTabLife("t1");
    expect(journalTabLife("t1")).toBe(first);
    expect(isJournalTabLive("t1", first)).toBe(true);
    releaseTabJournal("t1");
    expect(isJournalTabLive("t1", first)).toBe(false);
    const second = journalTabLife("t1");
    expect(second).not.toBe(first);
    expect(isJournalTabLive("t1", first)).toBe(false);
  });

  it("a save capture answering after its tab closed writes nothing back", async () => {
    const real = agentJournalFake.captureSaveToJournal.getMockImplementation()!;
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    agentJournalFake.captureSaveToJournal.mockImplementationOnce(async (input) => {
      await gate;
      return real(input);
    });
    const recorded = beginJournalSave("c1", "/closed.md", "text", { saveType: "manual" }).record();
    await new Promise((r) => setTimeout(r, 0));
    releaseTabJournal("c1"); // the tab closes while the capture is held
    open();
    await recorded;
    expect(journalObservedBase("c1", "path:/closed.md")).toBeNull();
  });

  it("a Save As whose bind answers after the tab closed and reopened does not move state onto it", async () => {
    useDocumentStore.getState().initDocument("c2", "x", "/from.md");
    const release = agentJournalEpochFake.holdNextBind();
    const ticket = beginJournalSave("c2", "/to.md", "x", { saveType: "manual" });
    useDocumentStore.getState().setFilePath("c2", "/to.md");
    const recorded = ticket.record();
    await new Promise((r) => setTimeout(r, 0));
    // Closed and reopened on its old path (the same tab id comes back) while the bind is held.
    releaseTabJournal("c2");
    useDocumentStore.getState().setFilePath("c2", "/from.md");
    release();
    await recorded;
    expect(journalObservedBase("c2", "path:/to.md")).toBeNull();
    // The reopened tab's own state stays its own, not redirected to the old Save As target.
    rememberJournalBasis("c2", "path:/from.md", "rev-new");
    expect(journalObservedBase("c2", "path:/from.md")).toEqual({ ref: "revision", revision: "rev-new" });
  });
});
