// WI-AL2.4 — "Clear reviewed" and the full backlog: Clear reviewed asks first, saying the step is irreversible, and on confirm settles every clearable hunk (kept, reverted, superseded, resolvedByHumanEdit) in one clearReviewed decision against the rendered head, persisting settled; cancelling sends nothing; it is disabled when nothing is clearable; at the writer's slot limit the backlog-full banner is shown, and it clears once the re-read history holds fewer hunks
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { resolveKey } from "@/test/i18nResolve";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { listDocumentHistory } from "@/services/agentJournal/docHistoryClient";
import type { HunkState } from "@/services/agentJournal/review/reviewTransitions";
import { useJournalFeed } from "@/components/McpHistory/useJournalFeed";
import { AGENT_SLOT_LIMIT } from "../reviewRows";
import { ReviewPanel } from "../ReviewPanel";
import { agentRow, createReviewWriter, type WriterHunk } from "./reviewWriterFake";

const TAB = "t-1";
const KEY = "path:/a.md";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

function Harness() {
  const feed = useJournalFeed(KEY, listDocumentHistory);
  return <ReviewPanel tabId={TAB} docKey={KEY} history={feed.value} onChanged={feed.refresh} />;
}

const hunk = (n: number, state: HunkState): WriterHunk => ({ hunkId: `h-${n}`, state, reviewGen: 1, span: { from: 0, to: 0 }, wrote: "", target: "rev-1" });
let writer: ReturnType<typeof createReviewWriter>;

function seed(states: HunkState[]) {
  writer = createReviewWriter({ head: "rev-1", rows: [agentRow("rev-1", 1)], hunks: states.map((s, i) => hunk(i, s)) });
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => writer.handle(command, args) as Promise<never>);
}

const clearButton = (count: number) => screen.findByRole("button", { name: en("review.clearReviewed", { count }) });

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, "abc", "/a.md");
});

describe("ReviewPanel — Clear reviewed", () => {
  it("asks first, then settles every clearable hunk in one decision", async () => {
    seed(["pending", "kept", "reverted", "superseded", "resolvedByHumanEdit", "conflicted"]);
    vi.mocked(ask).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await clearButton(4));

    expect(ask).toHaveBeenCalledWith(en("review.clearMessage", { count: 4 }), expect.objectContaining({ title: en("review.clearTitle"), kind: "warning" }));
    await waitFor(() => expect(writer.decisions).toHaveLength(1));
    expect(writer.decisions[0]).toEqual({
      docKey: KEY,
      expectedHead: "rev-1",
      action: "clearReviewed",
      items: ["h-1", "h-2", "h-3", "h-4"].map((hunkId) => ({ hunkId, expectedReviewGen: "1" })),
    });
    expect(writer.state.hunks.map((h) => h.state)).toEqual(["pending", "settled", "settled", "settled", "settled", "conflicted"]);
    expect(toast.success).toHaveBeenCalledWith(en("review.cleared", { count: 4 }));
    // The re-read shows nothing left to clear.
    expect(await clearButton(0)).toBeDisabled();
  });

  it("the confirmation says the step cannot be undone", () => {
    expect(en("review.clearMessage", { count: 2 })).toMatch(/cannot be undone/i);
  });

  it("cancelling sends nothing", async () => {
    seed(["kept", "pending"]);
    vi.mocked(ask).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await clearButton(1));

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(writer.decisions).toEqual([]);
    expect(writer.state.hunks[0].state).toBe("kept");
  });

  it("is disabled when nothing is clearable", async () => {
    seed(["pending", "conflicted"]);
    render(<Harness />);
    expect(await clearButton(0)).toBeDisabled();
  });
});

describe("ReviewPanel — the full backlog", () => {
  it("shows the banner at the slot limit and clears it once reviewed hunks are cleared", async () => {
    seed(["pending", ...Array.from({ length: AGENT_SLOT_LIMIT - 1 }, (): HunkState => "kept")]);
    vi.mocked(ask).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findByRole("alert")).toHaveTextContent(en("review.backlogFull", { count: AGENT_SLOT_LIMIT }));

    await user.click(await clearButton(AGENT_SLOT_LIMIT - 1));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(writer.decisions[0].items).toHaveLength(AGENT_SLOT_LIMIT - 1);
    expect(await screen.findByRole("list", { name: en("review.listLabel") })).toBeInTheDocument();
  });

  it("one hunk under the limit shows no banner", async () => {
    seed(Array.from({ length: AGENT_SLOT_LIMIT - 1 }, (): HunkState => "pending"));
    render(<Harness />);
    await screen.findByRole("list", { name: en("review.listLabel") });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
