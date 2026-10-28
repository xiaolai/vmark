// @vitest-environment node
// WI-AL2.1c — runJournaledEdit's post-apply certificate: what `certify` returns rides on the commit (never the prepare) and the outcome stays `applied`; a `certify` that throws or answers null leaves the commit a barrier with no certificate, still `applied` and durable (never `appliedWithError`), the failure logged; an edit with no `certify` sends no commit extras.

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
import { selectionCertificate, type SelectionCertificate } from "@/services/agentJournal/selectionCertificate";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT, testAdmittedReads } from "@/test/mcpAttributionFixture";
import { journalWarn } from "@/utils/debug";
import { runJournaledEdit, type JournaledEdit } from "../journaledEdit";
import { resolveTab, type GuardedTab } from "../tabGuard";

const TAB = "t1";
const PRE = "hello 中文";
const POST = "hello 世界";

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

function run(certify?: JournaledEdit<number>["certify"]) {
  const tab = seed();
  return runJournaledEdit("r1", {
    tab,
    preimage: tab.content,
    requireFocus: false,
    tool: "selection.set",
    context: TEST_WRITE_CONTEXT,
    reads: testAdmittedReads(),
    apply: () => {
      useDocumentStore.getState().setEditorContent(TAB, POST);
      return { postimage: POST, value: 1 };
    },
    ...(certify ? { certify } : {}),
  });
}

const prepared = () => fake.prepareControlledWrite.mock.calls[0][0] as { certificate?: unknown };
const committed = () => fake.commitControlledWrite.mock.calls[0] as unknown as [string, string, { certificate?: unknown } | undefined];

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

describe("runJournaledEdit — post-apply certificate", () => {
  it("rides on the commit, not the prepare, with the applied texts", async () => {
    const cert: SelectionCertificate = await selectionCertificate(PRE, { from: 6, to: 8, insert: "世界" });
    const certify = vi.fn(async () => cert);
    expect(await run(certify)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(certify).toHaveBeenCalledWith(PRE, POST);
    expect(prepared().certificate ?? null).toBeNull();
    expect(committed()[1]).toBe(POST);
    expect(committed()[2]?.certificate).toEqual(cert);
  });

  it.each([
    ["throws", async () => Promise.reject(new Error("boom"))],
    ["answers null", async () => null],
  ])("a certify that %s leaves the commit a barrier, still applied and durable", async (name, certify) => {
    expect(await run(certify)).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(fake.commitControlledWrite).toHaveBeenCalledTimes(1);
    expect(committed()[2]?.certificate ?? null).toBeNull();
    expect(useDocumentStore.getState().documents[TAB].content).toBe(POST);
    expect(vi.mocked(journalWarn).mock.calls.length > 0).toBe(name === "throws");
  });

  it("an edit with no certify sends no commit extras", async () => {
    expect(await run()).toEqual({ value: 1, durable: true, life: expect.any(Number) });
    expect(committed()[2]).toBeUndefined();
  });
});
