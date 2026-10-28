// @vitest-environment node
// runJournaledEdit refuses BEFORE anything is prepared when the tab its guards
// resolved has changed in the gap since (the callers' guards await): a user
// edit, a revision bump with unchanged text, a closed tab, or a tab whose
// document is gone each answer ABORTED with no prepare, no apply and nothing
// changed. Nothing is fabricated for a missing tab. An unchanged tab (CJK text
// included) still goes ahead. A tab closed and reopened under the same id while
// the prepare is awaited keeps the reopened tab's journal basis: the old edit's
// late outcome neither remembers nor forgets anything for it.
//
// Real stores; the journal IPC client is the in-memory fake
// (src/test/agentJournalFake.ts) with the writer's semantics.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { respond } from "@/services/mcpBridge/utils";
import {
  journalBasis,
  rememberJournalBasis,
  releaseTabJournal,
  resetJournalBases,
} from "@/services/agentJournal/documentIdentity";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT, testAdmittedReads } from "@/test/mcpAttributionFixture";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "@/services/agentJournal/unsavedProvenance";
import { runJournaledEdit } from "../journaledEdit";
import { resolveTab, type GuardedTab } from "../tabGuard";

const TAB = "t1";

function seed(text: string): GuardedTab {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/notes/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, text, "/notes/a.md");
  const guarded = resolveTab(TAB);
  if ("error" in guarded) throw new Error(guarded.message);
  return guarded;
}

const apply = vi.fn((): { postimage: string; value: number } => {
  useDocumentStore.getState().setEditorContent(TAB, "applied");
  return { postimage: "applied", value: 1 };
});

function run(tab: GuardedTab) {
  return runJournaledEdit("r1", {
    tab,
    preimage: tab.content,
    requireFocus: false,
    tool: "document.write",
    context: TEST_WRITE_CONTEXT,
    reads: testAdmittedReads(),
    apply,
  });
}

function refusal(): Record<string, unknown> {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === "r1");
  expect(call?.[0].success).toBe(false);
  return JSON.parse(call?.[0].error ?? "null") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  resetUnsavedProvenanceSources();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

describe("the tab changed between the guards and the prepare", () => {
  it("a user edit in the gap is ABORTED edited, with nothing prepared", async () => {
    const tab = seed("before");
    useDocumentStore.getState().setEditorContent(TAB, "user typed");

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("user typed");
  });

  it("a revision bump with the same text is ABORTED edited, with nothing prepared", async () => {
    const tab = seed("before");
    useRevisionStore.getState().updateRevision(TAB);

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("a tab closed in the gap is ABORTED closed, with nothing prepared", async () => {
    const tab = seed("before");
    useTabStore.setState({ tabs: { main: [] }, activeTabId: { main: null } });
    useDocumentStore.getState().removeDocument(TAB);

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a tab whose document is gone is ABORTED closed, no untitled key fabricated", async () => {
    const tab = seed("before");
    useDocumentStore.getState().removeDocument(TAB);

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });
});

describe("the tab moved to another journal document between the guards and the prepare", () => {
  it("a Save As in the gap is ABORTED closed: the edit is not prepared under the new key", async () => {
    const tab = seed("before");
    useDocumentStore.getState().setFilePath(TAB, "/notes/b.md");

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("the tab changed while its provenance payload was awaited", () => {
  /** A provenance source whose payload runs `during` before it answers. */
  function sourceRunning(during: () => void): { invalidated: () => boolean } {
    let invalidated = false;
    registerUnsavedProvenanceSource(TAB, {
      freeze: () => ({
        touched: false, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
        payload: async () => {
          during();
          return null;
        },
        recorded: () => {},
        invalidate: () => { invalidated = true; },
        release: () => { invalidated = true; },
      }),
      fork: () => ({ recorded: () => {}, invalidate: () => {} }),
    });
    return { invalidated: () => invalidated };
  }

  it("a user edit during the await is ABORTED edited: the prepare never sees the stale preimage", async () => {
    const tab = seed("before");
    const source = sourceRunning(() => useDocumentStore.getState().setEditorContent(TAB, "user typed"));

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "edited" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("user typed");
    expect(source.invalidated()).toBe(true);
  });

  it("a Save As during the await is ABORTED closed, with nothing prepared", async () => {
    const tab = seed("before");
    sourceRunning(() => useDocumentStore.getState().setFilePath(TAB, "/notes/b.md"));

    expect(await run(tab)).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED", reason: "closed" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
  });

  it("nothing changing during the await still prepares and applies", async () => {
    const tab = seed("before");
    sourceRunning(() => {});

    expect(await run(tab)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1);
  });
});

describe("an unchanged tab goes ahead", () => {
  it("prepares and applies (CJK text)", async () => {
    const tab = seed("测试 ABC 混合");

    expect(await run(tab)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe("the tab closes and its id reopens while the prepare is awaited", () => {
  const KEY = "path:/notes/a.md";

  it.each([
    ["the reopened tab has a basis of its own", "reopened-basis"],
    ["the reopened tab has no basis yet", null],
  ])("the old edit's outcome leaves the reopened tab's basis alone (%s)", async (_label, reopenedBasis) => {
    const tab = seed("before");
    fake.holdNextPrepare();
    const pending = run(tab);
    await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1));
    // Close: what tab cleanup does to the journal and the stores.
    releaseTabJournal(TAB);
    useDocumentStore.getState().removeDocument(TAB);
    // Reopen the same file under the same id, with other content.
    useDocumentStore.getState().initDocument(TAB, "重新打开\n", "/notes/a.md");
    if (reopenedBasis !== null) rememberJournalBasis(TAB, KEY, reopenedBasis);
    fake.release();

    expect(await pending).toBeNull();
    expect(refusal()).toMatchObject({ error: "ABORTED" });
    expect(apply).not.toHaveBeenCalled();
    expect(journalBasis(TAB, KEY)).toBe(reopenedBasis);
  });
});
