// @vitest-environment node
// WI-AL2.0j — an MCP edit answers within the bridge's 20 000 ms total in every never-settling case: a commit acknowledgement, an abort, readiness, the freeze payload, the prepare, and the slowest pre-apply followed by a commit that never settles
// Driven through the real chain — raw `invoke` → `journalIpc` →
// `journalClient` → the coordinator → `runJournaledEdit` — on fake timers;
// the answer is the edit's resolved value or its `respond()` refusal.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.unmock("@/services/agentJournal/journalTransport");

import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { respond } from "@/services/mcpBridge/utils";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { bindJournalDocument } from "@/services/agentJournal/documentBinding";
import { registerUnsavedProvenanceSource, resetUnsavedProvenanceSources } from "@/services/agentJournal/unsavedProvenance";
import type { NamedPayload } from "@/services/agentJournal/provenance/session";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { TEST_WRITE_CONTEXT, testAdmittedReads } from "@/test/mcpAttributionFixture";
import { runJournaledEdit } from "../journaledEdit";
import { resolveTab, type GuardedTab } from "../tabGuard";

/** The MCP bridge's total wait for one request (`REQUEST_TIMEOUT_TOTAL`). */
const BRIDGE_TOTAL_MS = 20_000;
const TAB = "t1";
const KEY = "path:/notes/a.md";
const PREPARED = { doc: "doc-1", txn: "txn-1", revision: "rev-1", generation: "1", baseline: null, certified: false, fallbackReason: null };
const DEFAULTS: Record<string, unknown> = {
  agent_journal_prepare: PREPARED,
  agent_journal_commit: { doc: "doc-1", revision: "rev-1", applied: true, durable: true, certified: false, fallbackReason: null },
  agent_journal_abort: { durable: true },
};

const invokeMock = vi.mocked(invoke);
const never = (): Promise<never> => new Promise<never>(() => {});
const after = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

function answer(overrides: Record<string, () => Promise<unknown>> = {}): void {
  invokeMock.mockImplementation(((command: string) => {
    const override = overrides[command];
    if (override) return override();
    if (command in DEFAULTS) return Promise.resolve(DEFAULTS[command]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  }) as typeof invoke);
}

function slowPayload(ms: number | null): void {
  registerUnsavedProvenanceSource(TAB, {
    freeze: () => ({
      touched: false, capture: { view: "v", session: "s", seq: "1" }, inTurn: (send) => send(),
      payload: () => (ms === null ? never() : after<NamedPayload | null>(ms, null)),
      recorded: () => {},
      invalidate: () => {}, release: () => {},
    }),
    fork: () => ({ recorded: () => {}, invalidate: () => {} }),
  });
}

function seed(): GuardedTab {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/notes/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, "before", "/notes/a.md");
  const guarded = resolveTab(TAB);
  if ("error" in guarded) throw new Error(guarded.message);
  return guarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockReset();
  resetJournalBases();
  resetUnsavedProvenanceSources();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const cases: Array<[string, () => void]> = [
  ["a commit acknowledgement never settles", () => answer({ agent_journal_commit: never })],
  [
    "an abort never settles",
    () =>
      answer({
        // The user types while the prepare is in flight: the re-verify aborts.
        agent_journal_prepare: () => {
          useDocumentStore.getState().setEditorContent(TAB, "user typed");
          return Promise.resolve(PREPARED);
        },
        agent_journal_abort: never,
      }),
  ],
  [
    "readiness never settles",
    () => {
      answer();
      agentJournalEpochFake.holdNextBind();
      void bindJournalDocument("tab:main/held", KEY);
    },
  ],
  [
    "the freeze payload never settles",
    () => {
      answer();
      slowPayload(null);
    },
  ],
  ["the prepare never settles", () => answer({ agent_journal_prepare: never })],
  [
    "the slowest pre-apply, then a commit that never settles",
    () => {
      answer({ agent_journal_prepare: () => after(3999, PREPARED), agent_journal_commit: never });
      slowPayload(3000);
    },
  ],
];

describe("runJournaledEdit answers within the bridge's total", () => {
  it.each(cases)("%s", async (_label, arrange) => {
    const tab = seed();
    arrange();
    let answered = false;
    void runJournaledEdit("r1", {
      tab,
      preimage: tab.content,
      requireFocus: false,
      tool: "document.write",
      context: TEST_WRITE_CONTEXT,
      reads: testAdmittedReads(),
      apply: () => {
        useDocumentStore.getState().setEditorContent(TAB, "applied");
        return { postimage: "applied", value: 1 };
      },
    }).then(
      (applied) => {
        answered = applied !== null || vi.mocked(respond).mock.calls.some(([r]) => r.id === "r1");
      },
      () => {
        answered = true;
      },
    );
    await vi.advanceTimersByTimeAsync(BRIDGE_TOTAL_MS);
    expect(answered).toBe(true);
  });
});
