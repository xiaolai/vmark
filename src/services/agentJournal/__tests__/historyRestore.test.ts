// @vitest-environment node
// WI-AL1.6 — a history restore is a controlled mutation: the overwritten buffer goes to the prepare (recorded first as a baseline), the restored text is applied only after re-verifying the tab (edited or closed during the prepare aborts and applies nothing), the commit carries the applied text, the tab's basis advances to the restore's revision, a tab that became another document (Save As) during the prepare aborts as closed, and a restore of an uncommitted entry reports what it resolves | AL2.2g: the restore prepare carries the frozen identity payload and is answered with a reply bound to it; a refusal is a notAdmitted request answer
import { describe, it, expect, vi, beforeEach } from "vitest";

// The journal transport is the shared wire fake (`src/test/globalTestHooks.ts`);
// the restore prepare is answered at the IPC boundary with a bound reply, as
// the real restore request parses it.
import { invoke } from "@tauri-apps/api/core";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import type { PrepareInput } from "../journalClient";
import type { PreparedRestore, RestorePrepareInput } from "../historyClient";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { journalBasis, releaseTabJournal, rememberJournalBasis, resetJournalBases } from "../documentIdentity";
import { restoreFromHistory } from "../historyRestore";

const TAB = "t-1";
const KEY = "path:/a.md";
const SOURCE = { from: "revision", revision: "rev-old" } as const;

const RESTORE = "agent_journal_restore_prepare";

/** Every restore prepare the window sent, decoded from its IPC payload. */
const prepareRestoreCalls = (): RestorePrepareInput[] =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === RESTORE)
    .map(([, args]) => JSON.parse((args as { payload: string }).payload) as RestorePrepareInput);

/** The fake's prepare, plus the source text the journal hands back, on the restore command's bound wire. */
function journalWith(text: string, resolves: string | null = null, during?: () => void) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command !== RESTORE) return undefined;
    return answerPrepare(args, async ({ source: _source, ...rest }) => {
      const p = await fake.prepareControlledWrite({ ...rest, tool: "history.restore" } as unknown as PrepareInput);
      during?.();
      const prepared: PreparedRestore = { ...p, text, resolves };
      return prepared;
    });
  });
}

const content = () => useDocumentStore.getState().documents[TAB]?.content;

beforeEach(() => {
  fake.reset();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(() => Promise.resolve());
  resetJournalBases();
  useDocumentStore.getState().removeDocument(TAB);
  useDocumentStore.getState().initDocument(TAB, "unsaved now", "/a.md");
});

describe("restoreFromHistory", () => {
  it("sends the overwritten buffer, applies the source text and commits it", async () => {
    journalWith("the earlier text");
    const out = await restoreFromHistory(TAB, SOURCE);
    expect(out).toMatchObject({ status: "applied", durable: true, changed: true, resolves: null });
    expect(prepareRestoreCalls()).toEqual([
      expect.objectContaining({ docKey: KEY, parent: null, preimage: "unsaved now", source: SOURCE }),
    ]);
    expect(content()).toBe("the earlier text");
    expect(fake.doc(KEY).text).toBe("the earlier text");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
  });

  it("states the tab's basis as the parent and advances it to the restore's revision", async () => {
    journalWith("x");
    await restoreFromHistory(TAB, SOURCE);
    const after = journalBasis(TAB, KEY);
    expect(after).toBe(fake.doc(KEY).head);
    journalWith("y");
    await restoreFromHistory(TAB, SOURCE);
    expect(prepareRestoreCalls().at(-1)).toMatchObject({ parent: after });
  });

  it.each([
    ["CJK and astral text", "長い文章 𝒳 😀"],
    ["an empty document", ""],
  ])("restores %s exactly", async (_label, text) => {
    journalWith(text);
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "applied" });
    expect(content()).toBe(text);
    expect(fake.doc(KEY).text).toBe(text);
  });

  it("an equal text is still recorded, unchanged", async () => {
    journalWith("unsaved now");
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "applied", changed: false });
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
  });

  it("an edit during the prepare aborts as edited and applies nothing", async () => {
    journalWith("the earlier text", null, () => useDocumentStore.getState().setEditorContent(TAB, "typed meanwhile"));
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "aborted", reason: "edited" });
    expect(content()).toBe("typed meanwhile");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "abort"]);
  });

  it("a tab closed during the prepare aborts as closed", async () => {
    journalWith("the earlier text", null, () => useDocumentStore.getState().removeDocument(TAB));
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "aborted", reason: "closed" });
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "abort"]);
  });

  it("a tab closed and reopened (same id, same text) during the prepare aborts as closed and learns nothing", async () => {
    journalWith("the earlier text", null, () => {
      useDocumentStore.getState().removeDocument(TAB);
      releaseTabJournal(TAB);
      useDocumentStore.getState().initDocument(TAB, "unsaved now", "/a.md");
    });
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "aborted", reason: "closed" });
    expect(content()).toBe("unsaved now");
    expect(journalBasis(TAB, KEY)).toBeNull();
  });

  it("a tab that became another document during the prepare aborts as closed", async () => {
    journalWith("the earlier text", null, () => useDocumentStore.getState().setFilePath(TAB, "/b.md"));
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "aborted", reason: "closed" });
    expect(content()).toBe("unsaved now");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "abort"]);
  });

  it("a missing tab never reaches the journal", async () => {
    journalWith("x");
    expect(await restoreFromHistory("t-none", SOURCE)).toMatchObject({ status: "aborted", reason: "closed" });
    expect(prepareRestoreCalls()).toEqual([]);
  });

  it("a refused prepare applies nothing and drops a stale basis", async () => {
    rememberJournalBasis(TAB, KEY, "rev-stale");
    journalWith("x");
    fake.refuseNextPrepares("STALE_PARENT");
    const out = await restoreFromHistory(TAB, SOURCE);
    expect(out).toMatchObject({ status: "refused" });
    expect(content()).toBe("unsaved now");
    expect(journalBasis(TAB, KEY)).toBeNull();
  });

  it("a restore of an uncommitted entry reports the entry it resolves", async () => {
    journalWith("before the agent", "txn-9");
    const out = await restoreFromHistory(TAB, { from: "uncommittedPreimage", txn: "txn-9" });
    expect(out).toMatchObject({ status: "applied", resolves: "txn-9" });
  });

  it("a commit the journal refuses is applied, not durable, and keeps the pre-restore basis", async () => {
    journalWith("x");
    fake.refuseNextCommits();
    const out = await restoreFromHistory(TAB, SOURCE);
    expect(out).toMatchObject({ status: "applied", durable: false });
    expect(content()).toBe("x");
  });

  /** A store listener that throws once the buffer holds `text`: the apply fails after the mutation landed. */
  function failAfterApplying(text: string, alsoClose = false): () => void {
    return useDocumentStore.subscribe((state) => {
      if (state.documents[TAB]?.content !== text) return;
      if (alsoClose) useDocumentStore.getState().removeDocument(TAB);
      throw new Error("listener crashed");
    });
  }

  it("an apply that fails after changing the buffer commits the text it holds: applied with error, never aborted", async () => {
    journalWith("長い文章 restored");
    const held = useRevisionStore.getState().getRevision(TAB);
    const stop = failAfterApplying("長い文章 restored");
    try {
      const out = await restoreFromHistory(TAB, SOURCE);
      expect(out).toMatchObject({ status: "appliedWithError", durable: true, changed: true, resolves: null });
    } finally {
      stop();
    }
    expect(content()).toBe("長い文章 restored");
    // The buffer changed: a client holding the old revision token is now STALE.
    expect(useRevisionStore.getState().getRevision(TAB)).not.toBe(held);
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit"]);
    expect(fake.doc(KEY).text).toBe("長い文章 restored");
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
  });

  it("an apply that throws with the buffer read back unchanged keeps the recorded baseline: the next restore is not refused STALE_PARENT", async () => {
    journalWith("first");
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "applied" });
    // The user types: the next prepare records that text as a baseline.
    useDocumentStore.getState().setEditorContent(TAB, "unsaved now");
    journalWith("長い文章 restored");
    // The editor rolls the buffer back to the preimage, then the listener crashes.
    const stop = useDocumentStore.subscribe((state) => {
      if (state.documents[TAB]?.content !== "長い文章 restored") return;
      useDocumentStore.getState().setEditorContent(TAB, "unsaved now");
      throw new Error("listener crashed");
    });
    try {
      await expect(restoreFromHistory(TAB, SOURCE)).rejects.toThrow("listener crashed");
    } finally {
      stop();
    }
    expect(content()).toBe("unsaved now");
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit", "prepare", "abort"]);
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
    journalWith("the earlier text");
    expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "applied", changed: true });
  });

  it("an apply that fails and leaves no buffer to read back keeps the restore open for recovery", async () => {
    journalWith("first");
    await restoreFromHistory(TAB, SOURCE);
    expect(journalBasis(TAB, KEY)).not.toBeNull();
    journalWith("the earlier text");
    const stop = failAfterApplying("the earlier text", true);
    try {
      expect(await restoreFromHistory(TAB, SOURCE)).toMatchObject({ status: "recoveryRequired" });
    } finally {
      stop();
    }
    expect(fake.log.map((e) => e.op)).toEqual(["prepare", "commit", "prepare"]);
    expect(fake.doc(KEY).reservedBy).not.toBeNull();
    expect(journalBasis(TAB, KEY)).toBeNull();
  });
});
