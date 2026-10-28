// @vitest-environment node
// WI-AL1.4 — observational capture of a save from the window: author (the human, or the agent for document.write's own text) vs initiator (manual, autosave, MCP client), the journaled flag yes/pending/no, a save during a held prepare reported pending and linearized after the commit, the observed_parent chain naming the tab's own pending observation, the prepare basis dropped after a pending save, a capture failure answering journaled no without throwing, the observed base frozen when the save is submitted (an agent commit during the disk write is not the save's parent), outstanding saves chained in submission order, a cancelled save keeping the base, each tab and file saving under its own window name, and only document.write claiming the head it wrote (equal text alone never elides) | AL2.2g: the agent writes these saves race are driven on the journal fake directly; the window's request protocol is not under test here
import { afterEach, describe, it, expect } from "vitest";
import { agentJournalFake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "../journalActor";
import { journalBasis, journalObservedBase, rememberJournalBasis, windowNameFor } from "../documentIdentity";
import { beginJournalSave, saveInitiatorFor } from "../saveJournal";
import type { SaveOrigin } from "@/services/persistence/saveOutcome";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";

const PATH = "/notes/读书笔记.md";
const KEY = `path:${PATH}`;
const TAB = "tab-1";

afterEach(() => resetUnsavedProvenanceSources());

const journalSave = (tab: string, path: string, content: string, origin: SaveOrigin) =>
  beginJournalSave(tab, path, content, origin).record();

const DOC_WRITE: SaveOrigin = { saveType: "mcp", toolName: "document.write", actor: TEST_ATTRIBUTION };
const WS_SAVE: SaveOrigin = { saveType: "mcp", toolName: "workspace.save", actor: TEST_ATTRIBUTION };

/** An agent write committed as the head, as `document.*` leaves it, straight on the journal. */
async function agentCommit(parent: string | null, preimage: string, text: string): Promise<string> {
  const p = await agentJournalFake.prepareControlledWrite({
    docKey: KEY, parent, preimage, actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write", baselineProvenance: null, baselineTouched: false,
  });
  return (await agentJournalFake.commitControlledWrite(p.txn, text)).revision;
}

function lastCapture() {
  const calls = agentJournalFake.captureSaveToJournal.mock.calls;
  return calls[calls.length - 1][0];
}

describe("saveInitiatorFor", () => {
  it("names who asked for the save; the author is always the human", () => {
    expect(saveInitiatorFor({ saveType: "manual" })).toEqual({ type: "human" });
    expect(saveInitiatorFor({ saveType: "auto" })).toEqual({ type: "system", reason: "autosave" });
    expect(
      saveInitiatorFor({ saveType: "mcp", toolName: "workspace.save", actor: TEST_ATTRIBUTION }),
    ).toEqual(journalActorFor(TEST_ATTRIBUTION));
  });
});

describe("journalSave", () => {
  it("records a first save of a file on its path key with no observed parent", async () => {
    const out = await journalSave(TAB, PATH, "第一版\n", { saveType: "manual" });
    expect(out.journaled).toBe("yes");
    expect(out.revision).toMatch(/^rev-save-/);
    expect(lastCapture()).toEqual({
      docKey: KEY,
      window: windowNameFor(TAB, KEY, "main"),
      observedParent: null,
      postimage: "第一版\n",
      initiator: { type: "human" },
      author: null,
      claimsRevision: null,
      provenance: null,
    });
    // The tab's next write and save build on the revision it now holds.
    expect(journalBasis(TAB, KEY)).toBe(out.revision);
    expect(journalObservedBase(TAB, KEY)).toEqual({ ref: "revision", revision: out.revision });
  });

  it("names the revision the tab last learned as the observed parent", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "auto" });
    await journalSave(TAB, PATH, "ab", { saveType: "auto" });
    expect(lastCapture().observedParent).toEqual({ ref: "revision", revision: first.revision });
    expect(lastCapture().initiator).toEqual({ type: "system", reason: "autosave" });
  });

  it("lets document.write claim the head it wrote, and answers yes at that revision", async () => {
    const r1 = await agentCommit(null, "", "agent text");
    rememberJournalBasis(TAB, KEY, r1);
    const out = await journalSave(TAB, PATH, "agent text", DOC_WRITE);
    expect(out).toEqual({ journaled: "yes", revision: r1, reason: null });
    expect(lastCapture()).toMatchObject({ author: journalActorFor(TEST_ATTRIBUTION), claimsRevision: r1 });
  });

  it("records a human save equal to the head as its own observation, never elided", async () => {
    const r1 = await agentCommit(null, "", "agent text");
    rememberJournalBasis(TAB, KEY, r1);
    const out = await journalSave(TAB, PATH, "agent text", { saveType: "manual" });
    expect(lastCapture()).toMatchObject({ author: null, claimsRevision: null });
    expect(out.journaled).toBe("yes");
    expect(out.revision).not.toBe(r1);
  });

  it("does not claim for a workspace.save: the buffer may hold human edits", async () => {
    const r1 = await agentCommit(null, "", "agent text");
    rememberJournalBasis(TAB, KEY, r1);
    await journalSave(TAB, PATH, "agent text", WS_SAVE);
    expect(lastCapture()).toMatchObject({ author: null, claimsRevision: null, initiator: journalActorFor(TEST_ATTRIBUTION) });
  });

  it("names the agent as author of document.write's text even with nothing to claim", async () => {
    agentJournalFake.failNextCommits(1);
    await agentCommit(null, "", "agent text");
    const out = await journalSave(TAB, PATH, "agent text", DOC_WRITE);
    expect(lastCapture()).toMatchObject({ author: journalActorFor(TEST_ATTRIBUTION), claimsRevision: null });
    expect(out.journaled).toBe("no");
  });

  it("ignores a claim the head no longer holds", async () => {
    const r1 = await agentCommit(null, "", "agent text");
    rememberJournalBasis(TAB, KEY, r1);
    const ticket = beginJournalSave(TAB, PATH, "agent text", DOC_WRITE);
    const r2 = await agentCommit(r1, "agent text", "other text");
    const out = await ticket.record();
    expect(lastCapture().claimsRevision).toBe(r1);
    expect(out.revision).not.toBe(r1);
    expect(out.revision).not.toBe(r2);
    expect(agentJournalFake.doc(KEY).text).toBe("agent text");
  });

  it("reports a save during a held prepare as pending, chains the next save on it, and drops the prepare basis", async () => {
    const base = await journalSave(TAB, PATH, "base", { saveType: "manual" });
    // Another window's agent write holds the document.
    const p = await agentJournalFake.prepareControlledWrite({
      docKey: KEY, parent: base.revision, preimage: "base", actor: journalActorFor(TEST_ATTRIBUTION), tool: "document.write", baselineProvenance: null, baselineTouched: false,
    });
    const b1 = await journalSave(TAB, PATH, "base 1", { saveType: "manual" });
    expect(b1).toEqual({ journaled: "pending", revision: null, reason: null });
    const obs = agentJournalFake.captureSaveToJournal.mock.results.at(-1);
    const b1Observation = ((await obs?.value) as { observation: string }).observation;
    expect(journalObservedBase(TAB, KEY)).toEqual({ ref: "pending", observation: b1Observation });
    expect(journalBasis(TAB, KEY)).toBeNull();
    const b2 = await journalSave(TAB, PATH, "base 12", { saveType: "manual" });
    expect(b2.journaled).toBe("pending");
    expect(lastCapture().observedParent).toEqual({ ref: "pending", observation: b1Observation });
    await agentJournalFake.commitControlledWrite(p.txn, "AGENT");
    // Both land after the commit, in order.
    expect(agentJournalFake.linearizedAs(b1Observation)).not.toBeNull();
    expect(agentJournalFake.doc(KEY).text).toBe("base 12");
  });

  it("answers no for a capture whose append failed, and the drain lands it", async () => {
    agentJournalFake.failNextCaptures(1);
    const out = await journalSave(TAB, PATH, "x", { saveType: "manual" });
    expect(out).toEqual({ journaled: "no", revision: null, reason: null });
    agentJournalFake.drain();
    expect(agentJournalFake.doc(KEY).text).toBe("x");
  });

  it.each(["JOURNAL_UNAVAILABLE", "INVALID_REQUEST"] as const)(
    "answers no with the reason for a %s capture failure, without throwing, and forgets the bases",
    async (code) => {
      rememberJournalBasis(TAB, KEY, "rev-old");
      agentJournalFake.refuseNextCaptures(code);
      const out = await journalSave(TAB, PATH, "y", { saveType: "manual" });
      expect(out).toEqual({ journaled: "no", revision: null, reason: code });
      expect(journalBasis(TAB, KEY)).toBeNull();
      expect(journalObservedBase(TAB, KEY)).toBeNull();
    },
  );

  it("refuses a lone surrogate as INVALID_TEXT and still resolves", async () => {
    const out = await journalSave(TAB, PATH, "bad \uD800", { saveType: "manual" });
    expect(out).toEqual({ journaled: "no", revision: null, reason: "INVALID_TEXT" });
  });

  it("records an empty file", async () => {
    const out = await journalSave(TAB, PATH, "", { saveType: "manual" });
    expect(out.journaled).toBe("yes");
    expect(agentJournalFake.doc(KEY).text).toBe("");
  });
});

describe("beginJournalSave: the observed base is the one the saved text was built on", () => {
  it("freezes the base at submission, so an agent commit during the disk write is not the parent", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const ticket = beginJournalSave(TAB, PATH, "ab", { saveType: "manual" });
    const agent = await agentCommit(first.revision, "a", "AGENT");
    rememberJournalBasis(TAB, KEY, agent);
    await ticket.record();
    expect(lastCapture().observedParent).toEqual({ ref: "revision", revision: first.revision });
  });

  it("a save answered in time leaves a basis a newer controlled edit set meanwhile", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const ticket = beginJournalSave(TAB, PATH, "ab", { saveType: "manual" });
    const agent = await agentCommit(first.revision, "a", "AGENT");
    rememberJournalBasis(TAB, KEY, agent);
    const out = await ticket.record();
    expect(out.journaled).not.toBe("no");
    expect(journalBasis(TAB, KEY)).toBe(agent);
    expect(journalObservedBase(TAB, KEY)).toEqual({ ref: "revision", revision: agent });
  });

  it("a refused save does not drop a basis a newer controlled edit set meanwhile", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const ticket = beginJournalSave(TAB, PATH, "ab", { saveType: "manual" });
    const agent = await agentCommit(first.revision, "a", "AGENT");
    rememberJournalBasis(TAB, KEY, agent);
    agentJournalFake.refuseNextCaptures("JOURNAL_UNAVAILABLE");
    await ticket.record();
    expect(journalBasis(TAB, KEY)).toBe(agent);
  });

  it("a queued save still chains on the save ahead of it, not on the controlled edit that landed meanwhile", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const s1 = beginJournalSave(TAB, PATH, "ab", { saveType: "manual" });
    const s2 = beginJournalSave(TAB, PATH, "abc", { saveType: "manual" });
    const agent = await agentCommit(first.revision, "a", "AGENT");
    rememberJournalBasis(TAB, KEY, agent);
    const r1 = await s1.record();
    await s2.record();
    expect(lastCapture().observedParent).toEqual({ ref: "revision", revision: r1.revision });
    expect(journalBasis(TAB, KEY)).toBe(agent);
  });

  it("chains a save submitted behind an outstanding one onto its result, whichever records first", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const s1 = beginJournalSave(TAB, PATH, "ab", { saveType: "auto" });
    const s2 = beginJournalSave(TAB, PATH, "abc", { saveType: "manual" });
    const second = s2.record();
    const r1 = await s1.record();
    await second;
    const parents = agentJournalFake.captureSaveToJournal.mock.calls.map(([i]) => i.observedParent);
    expect(parents.slice(1)).toEqual([
      { ref: "revision", revision: first.revision },
      { ref: "revision", revision: r1.revision },
    ]);
  });

  it("hands a cancelled save's base to the save behind it, and cancel is idempotent", async () => {
    const first = await journalSave(TAB, PATH, "a", { saveType: "manual" });
    const s1 = beginJournalSave(TAB, PATH, "ab", { saveType: "manual" });
    const s2 = beginJournalSave(TAB, PATH, "abc", { saveType: "manual" });
    s1.cancel();
    s1.cancel();
    await s2.record();
    expect(lastCapture().observedParent).toEqual({ ref: "revision", revision: first.revision });
    s2.cancel();
    expect(agentJournalFake.captureSaveToJournal).toHaveBeenCalledTimes(2);
  });

  it("keeps separate chains for separate tabs and files", async () => {
    const s1 = beginJournalSave(TAB, PATH, "x", { saveType: "manual" });
    const other = beginJournalSave("tab-2", PATH, "y", { saveType: "manual" });
    const elsewhere = beginJournalSave(TAB, "/notes/другой.md", "z", { saveType: "manual" });
    await other.record();
    await elsewhere.record();
    expect(agentJournalFake.captureSaveToJournal).toHaveBeenCalledTimes(2);
    await s1.record();
    expect(agentJournalFake.captureSaveToJournal).toHaveBeenCalledTimes(3);
  });

  it("answers a second record of one ticket without capturing again", async () => {
    const t = beginJournalSave(TAB, PATH, "once", { saveType: "manual" });
    const a = await t.record();
    const b = await t.record();
    expect(b).toEqual(a);
    expect(agentJournalFake.captureSaveToJournal).toHaveBeenCalledTimes(1);
  });
});
