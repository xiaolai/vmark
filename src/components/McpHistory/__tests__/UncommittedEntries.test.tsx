// WI-AL1.6, WI-AL1.7 — the history panel's uncommitted entries (who made each: provider, connection, session label; an unidentified client is never shown as a provider; the list follows the journal's generation broadcast): each is listed with its tool, agent and preview; restore puts its preimage back through the journal (the restore resolves the entry: its terminal record is appended and its pin dropped, so the row leaves the list), discard appends `discarded` (pin dropped, row gone); a refused action keeps the row and says so; a restore or discard whose record was not confirmed on disk warns beside its success; a document with none shows nothing

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** A journal stand-in: open entries are pinned; a terminal record unpins them. */
const journal = vi.hoisted(() => {
  const entries = new Map<string, Array<{ txn: string; preview: string; actor?: unknown }>>();
  const records: Array<{ txn: string; record: "resolved" | "discarded" }> = [];
  const pinned = (txn: string) => [...entries.values()].some((list) => list.some((e) => e.txn === txn));
  const drop = (txn: string) => {
    for (const [key, list] of entries) entries.set(key, list.filter((e) => e.txn !== txn));
  };
  return { entries, records, pinned, drop };
});

const client = vi.hoisted(() => ({
  listUncommitted: vi.fn(async (docKey: string) =>
    (journal.entries.get(docKey) ?? []).map((e, i) => ({
      txn: e.txn,
      actor: e.actor ?? { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId: "conn-1", sessionLabel: "s 1", displayName: null },
      tool: "document.write",
      seq: String(i + 1),
      preview: e.preview,
      complete: true,
    })),
  ),
  discardUncommitted: vi.fn(async (_docKey: string, txn: string) => {
    journal.records.push({ txn, record: "discarded" });
    journal.drop(txn);
    return { durable: true };
  }),
}));
vi.mock("@/services/agentJournal/historyClient", () => client);

const bus = vi.hoisted(() => {
  const handlers = new Set<() => void>();
  return { handlers, fire: () => handlers.forEach((h) => h()) };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, cb: () => void) => {
    bus.handlers.add(cb);
    return () => bus.handlers.delete(cb);
  }),
  emit: vi.fn(async () => undefined),
}));

const restore = vi.hoisted(() => ({
  restoreFromHistory: vi.fn(async (_tabId: string, source: { from: string; txn?: string }) => {
    const txn = source.txn ?? "";
    journal.records.push({ txn, record: "resolved" });
    journal.drop(txn);
    return { status: "applied", durable: true, changed: true, resolves: txn };
  }),
}));
vi.mock("@/services/agentJournal/historyRestore", () => restore);

const en = (key: string) => resolveKey(key, ["statusbar"]);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toastMock }));

import { act } from "@testing-library/react";
import { UncommittedEntries } from "../UncommittedEntries";
import { FEED_POLL_MS } from "@/services/agentJournal/journalFeed";
import { resolveKey } from "@/test/i18nResolve";

const KEY = "path:/a.md";

beforeEach(() => {
  journal.entries.clear();
  journal.records.length = 0;
  bus.handlers.clear();
  journal.entries.set(KEY, [
    { txn: "txn-1", preview: "before the agent 長い 😀" },
    { txn: "txn-2", preview: "" },
  ]);
  vi.clearAllMocks();
});

describe("UncommittedEntries", () => {
  it("lists each uncommitted entry with its tool, agent and preview", async () => {
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    expect(await screen.findByText("before the agent 長い 😀")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /restore the text this unrecorded write found/i })).toHaveLength(2);
    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/conn-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/s 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/empty document/i)).toBeInTheDocument();
  });

  it("restore resolves the entry: the terminal record is appended, the pin dropped and the row leaves", async () => {
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /restore the text this unrecorded write found/i });
    await user.click(first);
    expect(restore.restoreFromHistory).toHaveBeenCalledWith("t-1", { from: "uncommittedPreimage", txn: "txn-1" });
    expect(journal.records).toEqual([{ txn: "txn-1", record: "resolved" }]);
    expect(journal.pinned("txn-1")).toBe(false);
    await waitFor(() => expect(screen.queryByText("before the agent 長い 😀")).not.toBeInTheDocument());
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("discard appends discarded, drops the pin and the row leaves", async () => {
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /discard this unrecorded write/i });
    await user.click(first);
    expect(client.discardUncommitted).toHaveBeenCalledWith(KEY, "txn-1");
    expect(journal.records).toEqual([{ txn: "txn-1", record: "discarded" }]);
    expect(journal.pinned("txn-1")).toBe(false);
    await waitFor(() => expect(screen.queryByText("before the agent 長い 😀")).not.toBeInTheDocument());
    expect(journal.pinned("txn-2")).toBe(true);
  });

  it.each([
    ["restore", /restore the text this unrecorded write found/i, () => restore.restoreFromHistory.mockResolvedValueOnce({ status: "applied", durable: false, changed: true, resolves: "txn-1" } as never)],
    ["discard", /discard this unrecorded write/i, () => client.discardUncommitted.mockResolvedValueOnce({ durable: false })],
  ] as const)("a %s whose record was not confirmed on disk says so beside its success", async (_name, button, arrange) => {
    arrange();
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: button });
    await user.click(first);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith(en("mcpHistoryNotDurable")));
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("a refused restore keeps the row and reports the failure", async () => {
    restore.restoreFromHistory.mockResolvedValueOnce({ status: "aborted", reason: "edited" } as never);
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /restore the text this unrecorded write found/i });
    await user.click(first);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.getByText("before the agent 長い 😀")).toBeInTheDocument();
    expect(journal.pinned("txn-1")).toBe(true);
  });

  it("a restore the editor failed after applying warns that it was restored but the document needs checking", async () => {
    restore.restoreFromHistory.mockImplementationOnce(async (_tabId, source) => {
      journal.drop(source.txn ?? "");
      return { status: "appliedWithError", error: new Error("listener crashed"), durable: true, changed: true, resolves: source.txn ?? null } as never;
    });
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /restore the text this unrecorded write found/i });
    await user.click(first);
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/restored.*editor reported an error.*check the document/i));
    expect(toastMock.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("before the agent 長い 😀")).not.toBeInTheDocument());
  });

  it("a restore that could not be confirmed says the document stays locked until VMark restarts, once", async () => {
    restore.restoreFromHistory.mockResolvedValueOnce({ status: "recoveryRequired", error: new Error("tab gone") } as never);
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /restore the text this unrecorded write found/i });
    await user.click(first);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/could not confirm.*locked for agent edits until VMark restarts/i));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("a failed discard keeps the row and reports the failure", async () => {
    client.discardUncommitted.mockRejectedValueOnce(new Error("JOURNAL_BUSY"));
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [first] = await screen.findAllByRole("button", { name: /discard this unrecorded write/i });
    await user.click(first);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.getByText("before the agent 長い 😀")).toBeInTheDocument();
  });

  it("a click while an action is in flight is ignored", async () => {
    let finish: (v: { durable: boolean }) => void = () => undefined;
    client.discardUncommitted.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [discard] = await screen.findAllByRole("button", { name: /discard this unrecorded write/i });
    const [restoreButton] = screen.getAllByRole("button", { name: /restore the text this unrecorded write found/i });
    await user.click(discard);
    await user.click(discard);
    await user.click(restoreButton);
    finish({ durable: true });
    await waitFor(() => expect(client.listUncommitted).toHaveBeenCalledTimes(2));
    expect(client.discardUncommitted).toHaveBeenCalledTimes(1);
    expect(restore.restoreFromHistory).not.toHaveBeenCalled();
  });

  it("renders nothing for a document with no uncommitted entries", async () => {
    const { container } = render(<UncommittedEntries tabId="t-1" docKey="path:/none.md" />);
    await waitFor(() => expect(client.listUncommitted).toHaveBeenCalledWith("path:/none.md"));
    expect(container).toBeEmptyDOMElement();
  });

  it("an unavailable journal shows nothing rather than failing the panel", async () => {
    client.listUncommitted.mockRejectedValueOnce(new Error("JOURNAL_UNAVAILABLE"));
    const { container } = render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    await waitFor(() => expect(client.listUncommitted).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("an entry from an unidentified client says so, not a provider", async () => {
    journal.entries.set("path:/anon.md", [
      { txn: "txn-9", preview: "x", actor: { type: "mcp", principal: { state: "anonymous" }, connectionId: "c-9", sessionLabel: null, displayName: "claude" } },
    ]);
    render(<UncommittedEntries tabId="t-1" docKey="path:/anon.md" />);
    expect(await screen.findByText(/unidentified client/i)).toBeInTheDocument();
    expect(screen.getByText(/calls itself claude/i)).toBeInTheDocument();
  });

  it("follows the journal: an entry discarded in another window leaves the list", async () => {
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    expect(await screen.findByText("before the agent 長い 😀")).toBeInTheDocument();
    journal.drop("txn-1");
    await act(async () => bus.fire());
    await waitFor(() => expect(screen.queryByText("before the agent 長い 😀")).not.toBeInTheDocument());
  });

  it("never shows one document's entries under another while the new list is read", async () => {
    const OTHER = "path:/b.md";
    journal.entries.set(OTHER, [{ txn: "txn-b", preview: "other doc" }]);
    const { rerender } = render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    await screen.findByText("before the agent 長い 😀");
    let release: () => void = () => undefined;
    client.listUncommitted.mockImplementationOnce(
      (docKey: string) =>
        new Promise((resolve) => {
          release = () =>
            resolve((journal.entries.get(docKey) ?? []).map((e, i) => ({
              txn: e.txn,
              actor: { type: "human" },
              tool: "document.write",
              seq: String(i + 1),
              preview: e.preview,
              complete: true,
            })) as never);
        }),
    );
    rerender(<UncommittedEntries tabId="t-2" docKey={OTHER} />);
    expect(screen.queryByText("before the agent 長い 😀")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /discard this unrecorded write/i })).toHaveLength(0);
    await waitFor(() => expect(client.listUncommitted).toHaveBeenLastCalledWith(OTHER));
    await act(async () => release());
    expect(await screen.findByText("other doc")).toBeInTheDocument();
  });

  it("a list read for the previous document never lands under the next one", async () => {
    const OTHER = "path:/b.md";
    journal.entries.set(OTHER, [{ txn: "txn-b", preview: "other doc" }]);
    let finish: (v: { durable: boolean }) => void = () => undefined;
    client.discardUncommitted.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    const { rerender } = render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    const [discard] = await screen.findAllByRole("button", { name: /discard this unrecorded write/i });
    await user.click(discard);
    rerender(<UncommittedEntries tabId="t-2" docKey={OTHER} />);
    expect(await screen.findByText("other doc")).toBeInTheDocument();
    await act(async () => finish({ durable: true }));
    await waitFor(() => expect(client.listUncommitted).toHaveBeenLastCalledWith(OTHER));
    expect(screen.getByText("other doc")).toBeInTheDocument();
    expect(screen.queryByText("before the agent 長い 😀")).toBeNull();
  });

  it("an unreadable list after a good one shows nothing rather than stale entries", async () => {
    render(<UncommittedEntries tabId="t-1" docKey={KEY} />);
    await screen.findByText("before the agent 長い 😀");
    client.listUncommitted.mockRejectedValueOnce(new Error("JOURNAL_UNAVAILABLE"));
    await act(async () => bus.fire());
    await waitFor(() => expect(screen.queryByText("before the agent 長い 😀")).toBeNull());
  });

  describe("while live updates are not running", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

    it("an entry created in another window appears by polling, with no generation event", async () => {
      journal.entries.set(KEY, []);
      render(<UncommittedEntries tabId="t-1" docKey={KEY} pollMs={FEED_POLL_MS} />);
      await tick(0);
      expect(screen.queryByText("made elsewhere")).toBeNull();
      journal.entries.set(KEY, [{ txn: "txn-9", preview: "made elsewhere" }]);
      await tick(FEED_POLL_MS);
      expect(screen.getByText("made elsewhere")).toBeInTheDocument();
    });

    it("an entry resolved in another window leaves by polling, with no generation event", async () => {
      render(<UncommittedEntries tabId="t-1" docKey={KEY} pollMs={FEED_POLL_MS} />);
      await tick(0);
      expect(screen.getByText("before the agent 長い 😀")).toBeInTheDocument();
      journal.drop("txn-1");
      await tick(FEED_POLL_MS);
      expect(screen.queryByText("before the agent 長い 😀")).toBeNull();
    });
  });
});
