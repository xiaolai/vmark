// WI-AL2.4 — the review panel's stale-view guard survives re-reads: a re-read that shows the person the same list (a poll, or another document's journal change) does not accept an edit made since the list was shown, so a decision after it is still refused stale and not sent; the re-read after that refusal shows the list again, so the next decision is sent. Edge cases: a re-read of an unchanged list, an edit landing between the list's commit and React's later effects, recovery after the refusal
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { resolveKey } from "@/test/i18nResolve";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { listDocumentHistory } from "@/services/agentJournal/docHistoryClient";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { useJournalFeed } from "@/components/McpHistory/useJournalFeed";
import { ReviewPanel } from "../ReviewPanel";
import { agentRow, createReviewWriter } from "./reviewWriterFake";

const TAB = "t-1";
const KEY = "path:/a.md";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

let refresh: () => void = () => {};
function Harness() {
  const feed = useJournalFeed(KEY, listDocumentHistory);
  useEffect(() => {
    refresh = feed.refresh;
  }, [feed.refresh]);
  return <ReviewPanel tabId={TAB} docKey={KEY} history={feed.value} onChanged={feed.refresh} />;
}

let writer: ReturnType<typeof createReviewWriter>;
let stop: () => void = () => {};
const reads = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "agent_journal_history").length;
const keepButton = async () => {
  await screen.findByRole("list", { name: en("review.listLabel") });
  const row = screen.getAllByRole("listitem").map((li) => li.querySelector<HTMLElement>("[data-hunk-id='h-1']")).find(Boolean)!;
  return within(row).getByRole("button", { name: en("review.keep") });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetJournalBases();
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, "abc", "/a.md");
  stop = startProvenanceSessions();
  writer = createReviewWriter({
    head: "rev-1",
    rows: [agentRow("rev-1", 1)],
    hunks: [{ hunkId: "h-1", state: "pending", reviewGen: 7, span: { from: 1, to: 2 }, wrote: "b", target: "rev-1" }],
  });
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => writer.handle(command, args) as Promise<never>);
});

afterEach(() => stop());

describe("ReviewPanel — the stale-view guard across re-reads", () => {
  it("a re-read of the same list does not accept an edit made since it was shown", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await keepButton();

    useDocumentStore.getState().setEditorContent(TAB, "abcd");
    const before = reads();
    refresh();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 0));

    await user.click(await keepButton());
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedStale")));
    expect(writer.decisions).toEqual([]);
  });

  it("an edit made the moment the list appears, before any later task, is not accepted", async () => {
    const user = userEvent.setup();
    // A mutation callback runs as a microtask right after React's commit,
    // ahead of the passive effects React schedules for later.
    let edited = false;
    const observer = new MutationObserver(() => {
      if (edited || !document.querySelector("[data-hunk-id='h-1']")) return;
      edited = true;
      useDocumentStore.getState().setEditorContent(TAB, "abcd");
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      render(<Harness />);
      await user.click(await keepButton());
    } finally {
      observer.disconnect();
    }
    expect(edited).toBe(true);
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedStale")));
    expect(writer.decisions).toEqual([]);
  });

  it("after a stale refusal the re-read list is shown, so the next decision is sent", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await keepButton();

    useDocumentStore.getState().setEditorContent(TAB, "abcd");
    const before = reads();
    await user.click(await keepButton());
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedStale")));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 0));

    await user.click(await keepButton());
    await waitFor(() => expect(writer.decisions).toHaveLength(1));
    expect(writer.decisions[0]).toMatchObject({ action: "keep" });
  });
});
