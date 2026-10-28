// @vitest-environment node
// WI-AL2.1b — runJournaledEdit's declared script: an edit naming its whole-text `target` sends the script's certificate with the prepare (never the commit); a live editor that applies the target unchanged commits the certificate's postimage, one that re-serializes commits other text, so the journal's postimage check records a counted barrier; a script that cannot be built is logged and the write goes ahead as a barrier.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));
vi.mock("@/services/agentJournal/journalTransport", () =>
  import("@/test/agentJournalWireFake").then((m) => m.journalTransportModule()),
);

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { textHash } from "@/services/agentJournal/provenance/payload";
import { declaredScriptCertificate } from "@/services/agentJournal/review/declaredScript";
import type { SelectionCertificate } from "@/services/agentJournal/selectionCertificate";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT, testAdmittedReads } from "@/test/mcpAttributionFixture";
import { journalWarn } from "@/utils/debug";
import { runJournaledEdit } from "../journaledEdit";
import { resolveTab, type GuardedTab } from "../tabGuard";

const TAB = "t1";
const PRE = "# 标题\n\nhello 中文 😀\n";
const TARGET = "# 标题\n\nhello 世界 😁\n";

function seed(): GuardedTab {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/notes/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, PRE, "/notes/a.md");
  const guarded = resolveTab(TAB);
  if ("error" in guarded) throw new Error(guarded.message);
  return guarded;
}

/** A whole-text write of `target` whose editor leaves `applied` in the store. */
function run(target: string, applied: string) {
  const tab = seed();
  return runJournaledEdit("r1", {
    tab,
    preimage: tab.content,
    requireFocus: false,
    tool: "document.write",
    target,
    context: TEST_WRITE_CONTEXT,
    reads: testAdmittedReads(),
    apply: () => {
      useDocumentStore.getState().setEditorContent(TAB, applied);
      return { postimage: applied, value: 1 };
    },
  });
}

const prepared = () => fake.prepareControlledWrite.mock.calls[0][0] as { certificate?: SelectionCertificate };
const committed = () => fake.commitControlledWrite.mock.calls[0] as unknown as [string, string, { certificate?: unknown } | undefined];

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

describe("runJournaledEdit — declared script", () => {
  it("sends the script's certificate with the prepare, not the commit", async () => {
    expect(await run(TARGET, TARGET)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(prepared().certificate).toEqual(await declaredScriptCertificate(PRE, TARGET));
    expect(committed()[2]).toBeUndefined();
  });

  it("a live editor that applies the target unchanged commits the certificate's postimage", async () => {
    await run(TARGET, TARGET);
    expect(committed()[1]).toBe(TARGET);
    expect(prepared().certificate?.postHash).toBe(await textHash(committed()[1]));
  });

  it("a live editor that re-serializes commits other text, so the postimage check records a barrier", async () => {
    const reserialized = TARGET.replace("# 标题", "标题\n===");
    expect(await run(TARGET, reserialized)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(committed()[1]).toBe(reserialized);
    expect(prepared().certificate?.preHash).toBe(await textHash(PRE));
    expect(prepared().certificate?.postHash).not.toBe(await textHash(reserialized));
  });

  it("a script that cannot be built is logged, and the write goes ahead as a barrier", async () => {
    expect(await run("lone \uD800", TARGET)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(prepared().certificate).toBeUndefined();
    expect(vi.mocked(journalWarn)).toHaveBeenCalledWith(expect.stringContaining("document.write"), expect.anything());
  });
});
