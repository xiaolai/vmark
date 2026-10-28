// WI-AL2.2e — journal IPC failures injected at the client boundary, through the coordinator and through vmark.document.write: a prepare that rejects on its attempt and its one retry is refused with the tab's content unchanged and nothing committed; a commit that rejects after the apply answers applied but not durable, and the next mutation is refused while the writer still holds the unanswered transaction
//
// The journal IPC client is the in-memory fake (src/test/agentJournalFake.ts)
// with the writer's semantics; failures are injected on its spies, so the
// request coordinator (one retry of an uncertain prepare), the mutation
// coordinator, the MCP handler and the reply mapping all run for real.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import { useRevisionStore } from "@/stores/documentStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { runJournaledMutation } from "../journaledMutation";
import { KEY, TAB, content, mutation, ops, resetMutationFixture } from "./journaledMutationFixture";

const revision = () => useRevisionStore.getState().getRevision(TAB);
const write = (id: string, text: string) => handleDocumentWrite(id, { save: false, content: text }, TEST_WRITE_CONTEXT);

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

function refusal(requestId: string): Record<string, unknown> {
  const r = reply(requestId);
  expect(r.success).toBe(false);
  return JSON.parse(r.error ?? "null") as Record<string, unknown>;
}

/** Reject the prepare's attempt and its one retry: the request gives up. */
function failPrepare(): void {
  const down = new Error("ipc down");
  fake.prepareControlledWrite.mockRejectedValueOnce(down).mockRejectedValueOnce(down);
}

beforeEach(() => {
  vi.mocked(respond).mockClear();
  resetMutationFixture();
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
});

describe("journaled mutation — injected IPC failures", () => {
  it("an injected prepare failure leaves the content unchanged", async () => {
    const before = revision();
    failPrepare();
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_UNAVAILABLE" } });
    expect(content()).toBe("before");

    failPrepare();
    await write("p1", "AI\n");
    expect(refusal("p1")).toMatchObject({ error: "JOURNAL_UNAVAILABLE" });
    expect(content()).toBe("before");
    expect(revision()).toBe(before);
    expect(ops()).not.toContain("commit");
    expect(fake.doc(KEY).head).toBeNull();
  });

  it("an injected commit failure answers applied but not durable and blocks the next mutation", async () => {
    fake.commitControlledWrite.mockRejectedValueOnce(new Error("ipc closed"));
    await write("c1", "AI\n");
    expect(reply("c1")).toMatchObject({ success: true, data: { applied: true, durable: false } });
    expect(content()).toBe("AI\n");
    // The writer never heard the commit: its transaction still holds the document.
    expect(fake.doc(KEY).reservedBy).not.toBeNull();

    const next = await runJournaledMutation(mutation());
    expect(next).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_BUSY" } });
    await write("c2", "AI again\n");
    expect(refusal("c2")).toMatchObject({ error: "JOURNAL_BUSY" });
    expect(content()).toBe("AI\n");
  });
});
