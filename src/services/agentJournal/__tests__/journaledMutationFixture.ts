// Shared fixture for the journaled-mutation coordinator tests: a tab "t-1"
// holding "before" under "path:/a.md", and a mutation that writes "after"
// over it with every adapter overridable. The journal client is the shared
// in-memory fake (`src/test/globalTestHooks.ts`).
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { useDocumentStore } from "@/stores/documentStore";
import { journalActorFor } from "../journalActor";
import { controlledPrepare, type PreparedTxn } from "../journalClient";
import { journalTabLife, resetJournalBases } from "../documentIdentity";
import { resetUnsavedProvenanceSources } from "../unsavedProvenance";
import type { JournaledMutation, JournaledOutcome } from "../journaledMutation";

export const TAB = "t-1";
export const KEY = "path:/a.md";
const actor = journalActorFor(TEST_ATTRIBUTION);

export const content = () => useDocumentStore.getState().documents[TAB]?.content;
export const ops = () => fake.log.map((e) => e.op);

export type Mutation = JournaledMutation<string, PreparedTxn, JournaledOutcome<string>>;

/** A mutation that writes `after` over the tab's `before`; every adapter overridable. */
export function mutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    tabId: TAB,
    life: journalTabLife(TAB),
    docKey: KEY,
    preimage: content() ?? "",
    retryHint: "retry",
    prepare: (baseline) => controlledPrepare({ ...baseline, actor, tool: "test.tool" }),
    verify: () => null,
    apply: () => {
      useDocumentStore.getState().setEditorContent(TAB, "after");
      return { postimage: "after", value: "v" };
    },
    recover: () => {
      const now = content();
      if (now === undefined) throw new Error("tab gone");
      return now;
    },
    outcome: (o) => o,
    ...overrides,
  };
}

/** A fresh journal, bases, provenance sources, and the tab holding `before`. */
export function resetMutationFixture(): void {
  fake.reset();
  resetJournalBases();
  resetUnsavedProvenanceSources();
  useDocumentStore.getState().removeDocument(TAB);
  useDocumentStore.getState().initDocument(TAB, "before", "/a.md");
}
