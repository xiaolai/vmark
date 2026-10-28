// WI-AL2.4 — the full review backlog end to end: an agent document.write the writer refuses REVIEW_BACKLOG_FULL answers the agent with that token and its message (nothing applied); the review panel shows the person the backlog-full banner; Clear reviewed settles the reviewed hunks, the banner clears on the re-read, and the agent's next write is applied
//
// The agent's write runs through the production MCP handler and the journal
// wire fake; the review reads and decisions are answered by the review writer
// fake. The in-memory journal does not count review slots, so the writer's
// refusal is scripted on the prepare (the slot count itself is pinned by the
// Rust review_slots tests and, for the limit, by reviewRows.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { resolveKey } from "@/test/i18nResolve";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { listDocumentHistory } from "@/services/agentJournal/docHistoryClient";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import type { HunkState } from "@/services/agentJournal/review/reviewTransitions";
import { useJournalFeed } from "@/components/McpHistory/useJournalFeed";
import { AGENT_SLOT_LIMIT } from "../reviewRows";
import { ReviewPanel } from "../ReviewPanel";
import { agentRow, createReviewWriter } from "./reviewWriterFake";

const TAB = "t1";
const KEY = "path:/a.md";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

function Harness() {
  const feed = useJournalFeed(KEY, listDocumentHistory);
  return <ReviewPanel tabId={TAB} docKey={KEY} history={feed.value} onChanged={feed.refresh} />;
}

function answer(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}
const write = (id: string, content: string) => handleDocumentWrite(id, { save: false, content }, TEST_WRITE_CONTEXT);
const content = () => useDocumentStore.getState().documents[TAB]?.content;

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  resetJournalBases();
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "old document\n", "/a.md");
});

describe("REVIEW_BACKLOG_FULL — agent refusal, banner, clear, next write", () => {
  it("the agent is refused, the person sees the banner, and clearing reviewed changes lets the agent write again", async () => {
    const states: HunkState[] = ["pending", ...Array.from({ length: AGENT_SLOT_LIMIT - 1 }, (): HunkState => "kept")];
    const writer = createReviewWriter({
      head: "rev-1",
      rows: [agentRow("rev-1", 1)],
      hunks: states.map((state, i) => ({ hunkId: `h-${i}`, state, reviewGen: 1, span: { from: 0, to: 0 }, wrote: "", target: "rev-1" })),
    });
    vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => writer.handle(command, args) as Promise<never>);

    // 1. The agent's write is refused with the token it can act on, and nothing is applied.
    fake.refuseNextPrepares("REVIEW_BACKLOG_FULL");
    await write("w1", "AI text\n");
    const refused = answer("w1");
    expect(refused.success).toBe(false);
    expect(JSON.parse(refused.error ?? "null")).toMatchObject({
      error: "REVIEW_BACKLOG_FULL",
      message: expect.stringMatching(/ask the user to review/i) as unknown as string,
    });
    expect(content()).toBe("old document\n");

    // 2. The person sees why, in the review panel.
    vi.mocked(ask).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByRole("alert")).toHaveTextContent(en("review.backlogFull", { count: AGENT_SLOT_LIMIT }));

    // 3. Clear reviewed settles the kept hunks; the banner goes with the re-read.
    await user.click(await screen.findByRole("button", { name: en("review.clearReviewed", { count: AGENT_SLOT_LIMIT - 1 }) }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(writer.decisions.map((d) => d.action)).toEqual(["clearReviewed"]);

    // 4. The agent's next write is applied.
    await write("w2", "AI text\n");
    expect(answer("w2").success).toBe(true);
    expect(content()).toBe("AI text\n");
  });
});
