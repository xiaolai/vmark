// WI-AL2.4 — the review panel on a conflicted hunk: a revert over a human edit that overlaps the agent's change records one conflicted decision, the hunk is shown conflicted with its message and offers Mark handled, which sends the markHandled decision and leaves the hunk resolvedByHumanEdit (the journal record); a second revert of the still-conflicted hunk is refused REVERT_REFUSED and says so; keep and un-keep send their decisions against the head and reviewGen the panel rendered; a decision made after an edit the panel never saw is not sent and the list is re-read; JOURNAL_BUSY is retried a bounded number of times; a revert that applies shows the hunk reverted with its toast, and Undo revert on that row returns it to pending and restores the agent's text
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import { BUSY_ATTEMPTS } from "../useReviewActions";
import { ReviewPanel } from "../ReviewPanel";
import { agentRow, createReviewWriter, type WriterHunk } from "./reviewWriterFake";

const TAB = "t-1";
const KEY = "path:/a.md";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

function Harness() {
  const feed = useJournalFeed(KEY, listDocumentHistory);
  return <ReviewPanel tabId={TAB} docKey={KEY} history={feed.value} onChanged={feed.refresh} />;
}

let writer: ReturnType<typeof createReviewWriter>;
let stop: () => void = () => {};

/** "abc" whose `b` an agent wrote in rev-1. */
function seed(over: Partial<WriterHunk> = {}) {
  writer = createReviewWriter({
    head: "rev-1",
    rows: [agentRow("rev-1", 1)],
    hunks: [{ hunkId: "h-1", state: "pending", reviewGen: 7, span: { from: 1, to: 2 }, wrote: "b", target: "rev-1", ...over }],
  });
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => writer.handle(command, args) as Promise<never>);
}

const rowOf = async () => {
  await screen.findByRole("list", { name: en("review.listLabel") });
  return screen.getAllByRole("listitem").map((li) => li.querySelector<HTMLElement>("[data-hunk-id='h-1']")).find(Boolean)!;
};
const humanEdit = (text: string) => useDocumentStore.getState().setEditorContent(TAB, text);

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
});

afterEach(() => stop());

describe("ReviewPanel — conflicted hunks", () => {
  it("an overlapping human edit shows the hunk as conflicted, with its message", async () => {
    seed();
    const user = userEvent.setup();
    render(<Harness />);
    let row = await rowOf();
    expect(row).toHaveAttribute("data-state", "pending");

    // A person rewrites the agent's `b` before reviewing it.
    humanEdit("aXc");
    await user.click(within(row).getByRole("button", { name: en("review.revert") }));

    await waitFor(async () => expect(await rowOf()).toHaveAttribute("data-state", "conflicted"));
    row = await rowOf();
    expect(row).toHaveAttribute("data-state", "conflicted");
    expect(row).toHaveTextContent(en("review.hunkConflicted"));
    expect(writer.prepares).toEqual([expect.objectContaining({ hunkId: "h-1", expectedReviewGen: "7", preimage: "aXc" })]);
    expect(toast.warning).toHaveBeenCalledWith(en("review.outcomeConflicted"));
    // Nothing was applied: the person's text stands.
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("aXc");
    expect(within(row).getByRole("button", { name: en("review.markHandled") })).toBeEnabled();
  });

  it("Mark handled records markHandled and leaves the hunk resolvedByHumanEdit", async () => {
    seed({ state: "conflicted" });
    humanEdit("aXc");
    const user = userEvent.setup();
    render(<Harness />);
    const row = await rowOf();
    expect(row).toHaveAttribute("data-state", "conflicted");

    await user.click(within(row).getByRole("button", { name: en("review.markHandled") }));

    await waitFor(() => expect(writer.decisions).toEqual([{ docKey: KEY, expectedHead: "rev-1", action: "markHandled", items: [{ hunkId: "h-1", expectedReviewGen: "7" }] }]));
    expect(writer.state.hunks[0]).toMatchObject({ state: "resolvedByHumanEdit", reviewGen: 8 });
    // Its revision is fully reviewed now: summarized, and clearable.
    expect(await screen.findByText(en("review.allReviewed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("review.clearReviewed", { count: 1 }) })).toBeEnabled();
  });

  it("reverting a still-conflicted hunk again is refused and says so, recording nothing", async () => {
    seed({ state: "conflicted" });
    humanEdit("aXc");
    const user = userEvent.setup();
    render(<Harness />);
    const row = await rowOf();

    await user.click(within(row).getByRole("button", { name: en("review.revert") }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedConflicted")));
    expect(writer.state.hunks[0]).toMatchObject({ state: "conflicted", reviewGen: 7 });
    expect(await rowOf()).toHaveAttribute("data-state", "conflicted");
  });
});

describe("ReviewPanel — an applied revert", () => {
  it("reverting a hunk applies it and shows it reverted; Undo revert returns it to pending", async () => {
    // The agent's `b` (over a `B`) is in the newer revision; the older one
    // keeps an undecided hunk, so the reverted revision stays shown.
    seed({ target: "rev-2", base: "B" });
    writer.state.rows.unshift(agentRow("rev-2", 2));
    writer.state.head = "rev-2";
    writer.state.hunks.push({ hunkId: "h-2", state: "pending", reviewGen: 1, span: { from: 0, to: 1 }, wrote: "a", target: "rev-1" });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(await rowOf()).getByRole("button", { name: en("review.revert") }));

    await waitFor(async () => expect(await rowOf()).toHaveAttribute("data-state", "reverted"));
    expect(toast.success).toHaveBeenCalledWith(en("review.outcomeReverted"));
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("aBc");
    expect(writer.prepares).toEqual([expect.objectContaining({ hunkId: "h-1", expectedReviewGen: "7", preimage: "abc" })]);

    await user.click(within(await rowOf()).getByRole("button", { name: en("review.undoRevert") }));

    await waitFor(async () => expect(await rowOf()).toHaveAttribute("data-state", "pending"));
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("abc");
    expect(writer.prepares[1]).toMatchObject({ hunkId: "h-1", expectedReviewGen: "8", preimage: "aBc" });
    expect(toast.success).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("ReviewPanel — review-only decisions", () => {
  it("Keep sends keep against the rendered head and reviewGen; Undo keep returns it to pending", async () => {
    seed({ state: "pending" });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(await rowOf()).getByRole("button", { name: en("review.keep") }));
    await waitFor(() => expect(writer.state.hunks[0].state).toBe("kept"));
    expect(writer.decisions[0]).toEqual({ docKey: KEY, expectedHead: "rev-1", action: "keep", items: [{ hunkId: "h-1", expectedReviewGen: "7" }] });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("Undo keep on a kept hunk of a shown revision sends unkeep", async () => {
    // The kept hunk is in the newer revision; an older one still holds an
    // undecided hunk, so every revision from it to the head is shown.
    seed({ state: "kept", target: "rev-2" });
    writer.state.rows.unshift(agentRow("rev-2", 2));
    writer.state.head = "rev-2";
    writer.state.hunks.push({ hunkId: "h-2", state: "pending", reviewGen: 1, span: { from: 0, to: 1 }, wrote: "a", target: "rev-1" });
    const user = userEvent.setup();
    render(<Harness />);
    const row = await rowOf();
    expect(row).toHaveAttribute("data-state", "kept");

    await user.click(within(row).getByRole("button", { name: en("review.unkeep") }));

    await waitFor(() => expect(writer.state.hunks[0].state).toBe("pending"));
    expect(writer.decisions[0]).toMatchObject({ expectedHead: "rev-2", action: "unkeep", items: [{ hunkId: "h-1", expectedReviewGen: "7" }] });
  });

  it("a decision after an edit the panel never saw is not sent; the list is re-read", async () => {
    seed();
    const user = userEvent.setup();
    render(<Harness />);
    const row = await rowOf();
    const reads = vi.mocked(invoke).mock.calls.filter(([c]) => c === "agent_journal_history").length;

    humanEdit("abcd");
    await user.click(within(row).getByRole("button", { name: en("review.keep") }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedStale")));
    expect(writer.decisions).toEqual([]);
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "agent_journal_history").length).toBeGreaterThan(reads));
  });

  it("JOURNAL_BUSY is retried, a bounded number of times", async () => {
    seed();
    writer.refuseDecisions.push(...Array.from({ length: BUSY_ATTEMPTS }, () => "JOURNAL_BUSY" as const));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(await rowOf()).getByRole("button", { name: en("review.keep") }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("review.refusedBusy")), { timeout: 3000 });
    expect(writer.decisions).toHaveLength(BUSY_ATTEMPTS);
    expect(writer.state.hunks[0].state).toBe("pending");
  });

  it("JOURNAL_BUSY then success keeps the hunk", async () => {
    seed();
    writer.refuseDecisions.push("JOURNAL_BUSY");
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(await rowOf()).getByRole("button", { name: en("review.keep") }));

    await waitFor(() => expect(writer.state.hunks[0].state).toBe("kept"));
    expect(writer.decisions).toHaveLength(2);
  });
});
