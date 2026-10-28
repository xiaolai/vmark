// WI-AL1.7 — "Earlier checkpoints" (ADR-AL14): one global list of the checkpoints kept from before the edit history, for every file and window, newest first; a file's checkpoint names its file and an untitled one says so; restore goes through the earlier-checkpoint restore (an untitled entry restores into a new document; a file that cannot be opened falls back to one, and says so); the size and a clear-all are shown; the list follows the journal's generation broadcast, so a clear in another window empties it here; an empty or unreadable list renders nothing
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JournalCheckpoint } from "@/services/agentJournal/checkpointClient";

const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    handlers,
    fire(event: string) {
      for (const h of handlers.get(event) ?? []) h();
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: () => void) => {
    if (!bus.handlers.has(event)) bus.handlers.set(event, new Set());
    bus.handlers.get(event)!.add(cb);
    return () => bus.handlers.get(event)?.delete(cb);
  }),
  emit: vi.fn(async () => undefined),
}));

const store = vi.hoisted(() => ({ checkpoints: [] as JournalCheckpoint[] }));
const client = vi.hoisted(() => ({
  listJournalCheckpoints: vi.fn(async () => [...store.checkpoints]),
  forgetJournalCheckpoints: vi.fn(async (ids: readonly string[]) => {
    store.checkpoints = store.checkpoints.filter((c) => !ids.includes(c.id));
    return { forgotten: ids.length, blobError: null as string | null };
  }),
}));
vi.mock("@/services/agentJournal/checkpointClient", () => client);

const restorer = vi.hoisted(() => ({
  restoreEarlierCheckpoint: vi.fn(async (): Promise<unknown> => ({
    status: "restored",
    tabId: "t-new",
    outcome: { status: "applied", durable: true, changed: true, resolves: null },
    fallback: null,
  })),
}));
vi.mock("@/services/agentJournal/earlierCheckpointRestore", () => restorer);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toastMock }));

import { EarlierCheckpoints } from "../EarlierCheckpoints";
import { FEED_POLL_MS, GENERATION_EVENT } from "@/services/agentJournal/journalFeed";

type CheckpointFields = Omit<JournalCheckpoint, "id" | "tabId" | "filePath">;
type Anchor = { filePath: string } | { tabId: string };

/** A checkpoint of the file `/notes/a.md`, or of the file or untitled tab `anchor` names. */
const cp = (id: string, over: Partial<CheckpointFields> = {}, anchor: Anchor = { filePath: "/notes/a.md" }): JournalCheckpoint => {
  const rest = { id, timestamp: 1_000, tool: "document.write", description: `write ${id}`, contentBefore: "before", ...over };
  return "tabId" in anchor ? { ...rest, tabId: anchor.tabId, filePath: null } : { ...rest, tabId: null, filePath: anchor.filePath };
};

beforeEach(() => {
  vi.clearAllMocks();
  bus.handlers.clear();
  store.checkpoints = [
    cp("c1", { timestamp: 1_000 }),
    cp("c2", { timestamp: 3_000, contentBefore: "長い😀" }, { tabId: "t-old" }),
    cp("c3", { timestamp: 2_000 }, { filePath: "/other/b.md" }),
  ];
});

describe("EarlierCheckpoints", () => {
  it("lists every checkpoint newest first, naming its file or saying it is untitled", async () => {
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-checkpoint"))).toEqual(["c2", "c3", "c1"]);
    expect(within(items[0]).getByText(/untitled document/i)).toBeInTheDocument();
    expect(within(items[1]).getByText("b.md")).toBeInTheDocument();
    expect(within(items[2]).getByText("a.md")).toBeInTheDocument();
  });

  it("restores a checkpoint through the earlier-checkpoint restore", async () => {
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    const [first] = within(list).getAllByRole("button", { name: /restore this checkpoint/i });
    await user.click(first);
    expect(restorer.restoreEarlierCheckpoint).toHaveBeenCalledWith(store.checkpoints[1], "main");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("says when the file could not be opened and the text went into a new document", async () => {
    restorer.restoreEarlierCheckpoint.mockResolvedValueOnce({
      status: "restored",
      tabId: "t-new",
      outcome: { status: "applied", durable: true, changed: true, resolves: null },
      fallback: { path: "/notes/a.md", reason: "failed" },
    });
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    await user.click(within(list).getAllByRole("button", { name: /restore this checkpoint/i })[2]);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/\/notes\/a\.md.*new document/i)));
  });

  it("reports a failed restore and says nothing for a cancelled one", async () => {
    restorer.restoreEarlierCheckpoint
      .mockResolvedValueOnce({ status: "cancelled" })
      .mockResolvedValueOnce({ status: "restored", tabId: "t", outcome: { status: "aborted", reason: "edited" }, fallback: null });
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    const buttons = within(list).getAllByRole("button", { name: /restore this checkpoint/i });
    await user.click(buttons[0]);
    await waitFor(() => expect(restorer.restoreEarlierCheckpoint).toHaveBeenCalledTimes(1));
    expect(toastMock.error).not.toHaveBeenCalled();
    await user.click(buttons[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
  });

  it.each([true, false])(
    "a restore the editor failed after applying (durable %s) warns that it was restored but the document needs checking, and that its record is unconfirmed when it is",
    async (durable) => {
      restorer.restoreEarlierCheckpoint.mockResolvedValueOnce({
        status: "restored",
        tabId: "t",
        outcome: { status: "appliedWithError", error: new Error("listener crashed"), durable, changed: true, resolves: null },
        fallback: null,
      });
      const user = userEvent.setup();
      render(<EarlierCheckpoints windowLabel="main" />);
      const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
      await user.click(within(list).getAllByRole("button", { name: /restore this checkpoint/i })[0]);
      // An unconfirmed history record adds its own warning beside it.
      await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(durable ? 1 : 2));
      expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/restored.*editor reported an error.*check the document/i));
      if (!durable) expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/could not confirm the edit history was saved to disk/i));
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
    },
  );

  it("a restore that could not be confirmed says the document stays locked for agent edits until VMark restarts", async () => {
    restorer.restoreEarlierCheckpoint.mockResolvedValueOnce({
      status: "restored",
      tabId: "t",
      outcome: { status: "recoveryRequired", error: new Error("tab gone") },
      fallback: null,
    });
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    await user.click(within(list).getAllByRole("button", { name: /restore this checkpoint/i })[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/could not confirm.*locked for agent edits until VMark restarts/i));
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("shows the count and the size of the kept text, and clears them all", async () => {
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    expect(await screen.findByText(/3 checkpoints · 22 B/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear all checkpoint history/i }));
    expect(client.forgetJournalCheckpoints).toHaveBeenCalledWith(["c2", "c3", "c1"]);
    await act(async () => bus.fire(GENERATION_EVENT));
    await waitFor(() => expect(screen.queryByRole("list", { name: /earlier checkpoints/i })).toBeNull());
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("warns when the records are cleared but their text stays on disk until the next compaction", async () => {
    client.forgetJournalCheckpoints.mockResolvedValueOnce({ forgotten: 3, blobError: "pack compaction failed" });
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    await user.click(await screen.findByRole("button", { name: /clear all checkpoint history/i }));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/next compaction/i));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("reports a failed clear as a failed clear, not a failed restore", async () => {
    client.forgetJournalCheckpoints.mockRejectedValueOnce(new Error("JOURNAL_BUSY"));
    const user = userEvent.setup();
    render(<EarlierCheckpoints windowLabel="main" />);
    await user.click(await screen.findByRole("button", { name: /clear all checkpoint history/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/could not clear/i));
  });

  it("renders a checkpoint whose time is outside what a Date can hold, without a time", async () => {
    store.checkpoints = [cp("c1", { timestamp: 8_700_000_000_000_000 })];
    render(<EarlierCheckpoints windowLabel="main" />);
    const list = await screen.findByRole("list", { name: /earlier checkpoints/i });
    expect(list.querySelector("time")).toBeNull();
    expect(within(list).getByText("write c1")).toBeInTheDocument();
  });

  it("stops showing the list once a later read fails, so a stale entry cannot be restored", async () => {
    render(<EarlierCheckpoints windowLabel="main" />);
    await screen.findByRole("list", { name: /earlier checkpoints/i });
    client.listJournalCheckpoints.mockRejectedValueOnce(new Error("JOURNAL_UNAVAILABLE"));
    await act(async () => bus.fire(GENERATION_EVENT));
    await waitFor(() => expect(screen.queryByRole("list", { name: /earlier checkpoints/i })).toBeNull());
  });

  it("follows a change made in another window", async () => {
    render(<EarlierCheckpoints windowLabel="main" />);
    await screen.findByRole("list", { name: /earlier checkpoints/i });
    store.checkpoints = [cp("c9", { description: "from another window" })];
    await act(async () => bus.fire(GENERATION_EVENT));
    expect(await screen.findByText("from another window")).toBeInTheDocument();
    expect(screen.queryByText("write c1")).toBeNull();
  });

  it("renders nothing with no checkpoints, or when they cannot be read", async () => {
    store.checkpoints = [];
    const { container, unmount } = render(<EarlierCheckpoints windowLabel="main" />);
    await waitFor(() => expect(client.listJournalCheckpoints).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    client.listJournalCheckpoints.mockRejectedValueOnce(new Error("JOURNAL_UNAVAILABLE"));
    const second = render(<EarlierCheckpoints windowLabel="main" />);
    await waitFor(() => expect(client.listJournalCheckpoints).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });

  describe("while live updates are not running", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

    it("a clear in another window empties the list by polling, with no generation event", async () => {
      render(<EarlierCheckpoints windowLabel="main" pollMs={FEED_POLL_MS} />);
      await tick(0);
      expect(screen.getByRole("list", { name: /earlier checkpoints/i })).toBeInTheDocument();
      store.checkpoints = [];
      await tick(FEED_POLL_MS);
      expect(screen.queryByRole("list", { name: /earlier checkpoints/i })).toBeNull();
    });

    it("does not poll while live updates are running", async () => {
      render(<EarlierCheckpoints windowLabel="main" pollMs={null} />);
      await tick(0);
      const calls = client.listJournalCheckpoints.mock.calls.length;
      await tick(FEED_POLL_MS * 3);
      expect(client.listJournalCheckpoints).toHaveBeenCalledTimes(calls);
    });
  });
});
