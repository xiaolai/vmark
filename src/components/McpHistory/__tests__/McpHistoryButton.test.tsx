// WI-AL1.7 — the history button and panel: the badge counts the focused document's agent revisions, read from the journal under the document's key (path key for a saved file, tab key for an untitled tab); every change in any window reaches it through the generation broadcast, so two windows showing the same document converge after one append; a failed, read-only or behind journal, a queued or refused record of this document, recording suspended because its identity could not be updated, or a blocked revert marks the button as needing attention; the panel holds the status, the unrecorded writes, the revisions and the earlier checkpoints; when live updates never start (the event forwarder could not spawn, so no event ever comes) the panel observes the failure, says so, and still shows a revision appended in another window by polling, as do the panel's unrecorded writes and earlier checkpoints, while polling stops once live updates are ready, for a journal that never started, and on unmount; the Escape that ends an IME composition does not close the panel (WI-AL3.2)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentHistory, HistoryRow } from "@/services/agentJournal/docHistoryClient";
import type { JournalHealth } from "@/services/agentJournal/journalStatusClient";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

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

const journal = vi.hoisted(() => ({
  docs: new Map<string, DocumentHistory>(),
  health: { phase: "ready", generation: "1", readOnly: false, degraded: false, liveUpdates: "ready", error: null } as JournalHealth,
}));
vi.mock("@/services/agentJournal/docHistoryClient", () => ({
  listDocumentHistory: vi.fn(async (key: string) => journal.docs.get(key) ?? { generation: "1", rows: [], truncated: false, hunks: [], blocked: [], degraded: false }),
}));
vi.mock("@/services/agentJournal/journalStatusClient", () => ({
  readJournalHealth: vi.fn(async () => ({ ...journal.health })),
}));
vi.mock("@/services/agentJournal/checkpointClient", () => ({
  listJournalCheckpoints: vi.fn(async () => [
    { id: "c1", tabId: null, filePath: "/old.md", timestamp: 1, tool: "document.write", description: "old write", contentBefore: "x" },
  ]),
  forgetJournalCheckpoints: vi.fn(async () => 0),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toastMock }));

import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { FEED_POLL_MS, GENERATION_EVENT } from "@/services/agentJournal/journalFeed";
import { listDocumentHistory } from "@/services/agentJournal/docHistoryClient";
import { readJournalHealth } from "@/services/agentJournal/journalStatusClient";
import { listJournalCheckpoints } from "@/services/agentJournal/checkpointClient";
import { McpHistoryButton } from "../McpHistoryButton";

const agentRow = (revision: string, parent: string | null): HistoryRow => ({
  revision,
  seq: revision.slice(1),
  at: 0,
  kind: "controlled",
  parent,
  actor: { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId: "c-1", sessionLabel: null, displayName: null },
  initiator: null,
  tool: "document.write",
  restore: false,
  collected: false,
  addresses: [],
});
const humanRow = (revision: string, parent: string | null): HistoryRow => ({ ...agentRow(revision, parent), actor: { type: "human" }, kind: "observed", tool: null });
const historyOf = (rows: HistoryRow[], over: Partial<DocumentHistory> = {}): DocumentHistory => ({ generation: "1", head: rows[0]?.revision ?? null, rows, truncated: false, hunks: [], blocked: [], degraded: false, ...over });

function setup(filePath: string | null) {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", formatId: "markdown", id: "tab-1", filePath, title: "notes", isPinned: false }] },
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
  });
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument("tab-1", "current", filePath ?? undefined);
}

const trigger = () => screen.getAllByRole("button", { name: /MCP write history/i })[0];

beforeEach(() => {
  vi.clearAllMocks();
  bus.handlers.clear();
  journal.docs.clear();
  journal.health = { phase: "ready", generation: "1", readOnly: false, degraded: false, liveUpdates: "ready", identity: "durable", error: null, identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 };
  useJournalRecordingStore.getState().reset();
  // The real unrecorded-writes list reads the journal over IPC: one entry for /notes.md.
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command !== "agent_journal_uncommitted") return undefined;
    const { docKey } = JSON.parse((args as { payload: string }).payload) as { docKey: string };
    return docKey === "path:/notes.md"
      ? [{ txn: "x1", actor: { type: "human" }, tool: "document.write", seq: "4", preview: "lost write text", complete: true }]
      : [];
  });
  setup("/notes.md");
});

describe("McpHistoryButton", () => {
  it("shows no badge when the document has no agent revisions", async () => {
    journal.docs.set("path:/notes.md", historyOf([humanRow("r1", null)]));
    const { container } = render(<McpHistoryButton />);
    await waitFor(() => expect(trigger()).toHaveAttribute("data-loaded", "true"));
    expect(container.querySelector(".status-mcp-history__badge")).toBeNull();
  });

  it("counts the focused document's agent revisions, read under its path key", async () => {
    journal.docs.set("path:/notes.md", historyOf([agentRow("r3", "r2"), humanRow("r2", "r1"), agentRow("r1", null)]));
    const { container } = render(<McpHistoryButton />);
    await waitFor(() => expect(container.querySelector(".status-mcp-history__badge")?.textContent).toBe("2"));
  });

  it("reads an untitled tab's history under its tab key", async () => {
    setup(null);
    journal.docs.set("tab:main/tab-1", historyOf([agentRow("r1", null)]));
    const { container } = render(<McpHistoryButton />);
    await waitFor(() => expect(container.querySelector(".status-mcp-history__badge")?.textContent).toBe("1"));
  });

  it("follows a revision appended in any window, and two windows converge on one event", async () => {
    journal.docs.set("path:/notes.md", historyOf([agentRow("r1", null)]));
    const first = render(<McpHistoryButton />);
    const second = render(<McpHistoryButton />);
    const badges = () => [first, second].map((v) => v.container.querySelector(".status-mcp-history__badge")?.textContent);
    await waitFor(() => expect(badges()).toEqual(["1", "1"]));
    journal.docs.set("path:/notes.md", historyOf([agentRow("r2", "r1"), agentRow("r1", null)]));
    await act(async () => bus.fire(GENERATION_EVENT));
    await waitFor(() => expect(badges()).toEqual(["2", "2"]));
  });

  it("marks a degraded journal as needing attention", async () => {
    journal.health = { ...journal.health, degraded: true };
    render(<McpHistoryButton />);
    await waitFor(() => expect(trigger()).toHaveAccessibleName(/needs attention/i));
    expect(trigger()).toHaveClass("has-warning");
  });

  it("marks a save of this document the history refused, and not one of another document", async () => {
    render(<McpHistoryButton />);
    await waitFor(() => expect(trigger()).toHaveAttribute("data-loaded", "true"));
    act(() => useJournalRecordingStore.getState().report("path:/other.md", 1, { kind: "refused", code: "JOURNAL_DEGRADED" }));
    expect(trigger()).not.toHaveClass("has-warning");
    act(() => useJournalRecordingStore.getState().report("path:/notes.md", 2, { kind: "timeout", code: "JOURNAL_TIMEOUT" }));
    expect(trigger()).toHaveClass("has-warning");
  });

  it("says recording is suspended for this document while its identity could not be updated", async () => {
    const user = userEvent.setup();
    render(<McpHistoryButton />);
    await waitFor(() => expect(trigger()).toHaveAttribute("data-loaded", "true"));
    act(() => useJournalRecordingStore.getState().setUnbound("path:/other.md", true));
    expect(trigger()).not.toHaveClass("has-warning");
    act(() => useJournalRecordingStore.getState().setUnbound("path:/notes.md", true));
    expect(trigger()).toHaveClass("has-warning");
    await user.click(trigger());
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
      "History recording is suspended because document identity could not be updated.",
    );
    act(() => useJournalRecordingStore.getState().setUnbound("path:/notes.md", false));
    expect(trigger()).not.toHaveClass("has-warning");
  });

  it("opens a panel with the status, the unrecorded writes, the revisions and the earlier checkpoints", async () => {
    journal.docs.set("path:/notes.md", historyOf([agentRow("r1", null)], { degraded: true }));
    const user = userEvent.setup();
    render(<McpHistoryButton />);
    await waitFor(() => expect(trigger()).toHaveAttribute("data-loaded", "true"));
    await user.click(trigger());
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByRole("status")).toHaveTextContent(/queued/i);
    expect(await within(panel).findByText("lost write text")).toBeInTheDocument();
    expect(within(panel).getByTestId("history-row-r1")).toBeInTheDocument();
    expect(await within(panel).findByRole("list", { name: /earlier checkpoints/i })).toBeInTheDocument();
  });

  it("after a failed refresh offers none of the history it read before: no badge, no rows to restore", async () => {
    journal.docs.set("path:/notes.md", historyOf([agentRow("r1", null)]));
    const user = userEvent.setup();
    const { container } = render(<McpHistoryButton />);
    await waitFor(() => expect(container.querySelector(".status-mcp-history__badge")?.textContent).toBe("1"));
    await user.click(trigger());
    expect(within(screen.getByRole("dialog")).getByTestId("history-row-r1")).toBeInTheDocument();

    vi.mocked(listDocumentHistory).mockRejectedValueOnce(new Error("journal unreadable"));
    await act(async () => bus.fire(GENERATION_EVENT));

    const panel = screen.getByRole("dialog");
    await waitFor(() => expect(within(panel).getByText(/history could not be read/i)).toBeInTheDocument());
    expect(within(panel).queryByTestId("history-row-r1")).toBeNull();
    expect(container.querySelector(".status-mcp-history__badge")).toBeNull();
  });

  it("re-reads when the focused document changes and never shows the previous one's history", async () => {
    journal.docs.set("path:/notes.md", historyOf([agentRow("r1", null), agentRow("r0", null)]));
    journal.docs.set("path:/b.md", historyOf([agentRow("r9", null)]));
    const { container } = render(<McpHistoryButton />);
    await waitFor(() => expect(container.querySelector(".status-mcp-history__badge")?.textContent).toBe("2"));
    act(() => useDocumentStore.getState().setFilePath("tab-1", "/b.md"));
    await waitFor(() => expect(container.querySelector(".status-mcp-history__badge")?.textContent).toBe("1"));
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    render(<McpHistoryButton />);
    await user.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not close on the Escape that ends an IME composition", async () => {
    const user = userEvent.setup();
    render(<McpHistoryButton />);
    await user.click(trigger());
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("without live updates", () => {
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    const badge = (c: HTMLElement) => c.querySelector(".status-mcp-history__badge")?.textContent;

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("observes a forwarder that never started and shows another window's append by polling", async () => {
      journal.health = { ...journal.health, liveUpdates: "starting" };
      journal.docs.set("path:/notes.md", historyOf([agentRow("r1", null)]));
      const { container } = render(<McpHistoryButton />);
      await tick(0);
      expect(badge(container)).toBe("1");
      // Three spawn failures: the status says so; no generation event is ever fired.
      journal.health = { ...journal.health, liveUpdates: "failed" };
      journal.docs.set("path:/notes.md", historyOf([agentRow("r2", "r1"), agentRow("r1", null)]));
      await tick(FEED_POLL_MS);
      expect(badge(container)).toBe("2");
      expect(trigger()).toHaveAccessibleName(/needs attention/i);
      fireEvent.click(trigger());
      expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(/live updates.*unavailable/i);
      journal.docs.set("path:/notes.md", historyOf([agentRow("r3", "r2"), agentRow("r2", "r1"), agentRow("r1", null)]));
      await tick(FEED_POLL_MS);
      expect(badge(container)).toBe("3");
      expect(bus.handlers.get(GENERATION_EVENT)?.size ?? 0).toBeGreaterThan(0);
    });

    it("polls the panel's unrecorded writes and earlier checkpoints too, with no generation event", async () => {
      journal.health = { ...journal.health, liveUpdates: "starting" };
      render(<McpHistoryButton />);
      await tick(0);
      fireEvent.click(trigger());
      await tick(0);
      const panel = screen.getByRole("dialog");
      expect(within(panel).getByText("lost write text")).toBeInTheDocument();
      expect(within(panel).getByText("old write")).toBeInTheDocument();
      // Another window resolves the write and clears the checkpoints.
      vi.mocked(invoke).mockImplementation(async (command: string) => (command === "agent_journal_uncommitted" ? [] : undefined));
      vi.mocked(listJournalCheckpoints).mockResolvedValue([]);
      await tick(FEED_POLL_MS);
      expect(within(panel).queryByText("lost write text")).toBeNull();
      expect(within(panel).queryByText("old write")).toBeNull();
    });

    it("stops polling once live updates are ready", async () => {
      journal.health = { ...journal.health, liveUpdates: "starting" };
      render(<McpHistoryButton />);
      await tick(0);
      journal.health = { ...journal.health, liveUpdates: "ready" };
      await tick(FEED_POLL_MS);
      await tick(0);
      const [history, health] = [vi.mocked(listDocumentHistory).mock.calls.length, vi.mocked(readJournalHealth).mock.calls.length];
      await tick(FEED_POLL_MS * 3);
      expect(vi.mocked(listDocumentHistory).mock.calls.length).toBe(history);
      expect(vi.mocked(readJournalHealth).mock.calls.length).toBe(health);
    });

    it("does not poll a journal that never started", async () => {
      journal.health = { phase: "failed", generation: null, readOnly: false, degraded: false, liveUpdates: "failed", identity: "sessionOnly", error: "disk", identityError: null, retention: null, uncertifiedFallbacks: 0, registrationCapRefusals: 0, cleanupWorkerFailures: 0 };
      render(<McpHistoryButton />);
      await tick(0);
      const reads = vi.mocked(readJournalHealth).mock.calls.length;
      await tick(FEED_POLL_MS * 3);
      expect(vi.mocked(readJournalHealth).mock.calls.length).toBe(reads);
    });

    it("stops polling on unmount", async () => {
      journal.health = { ...journal.health, liveUpdates: "failed" };
      const view = render(<McpHistoryButton />);
      await tick(0);
      view.unmount();
      const reads = vi.mocked(listDocumentHistory).mock.calls.length + vi.mocked(readJournalHealth).mock.calls.length;
      await tick(FEED_POLL_MS * 3);
      expect(vi.mocked(listDocumentHistory).mock.calls.length + vi.mocked(readJournalHealth).mock.calls.length).toBe(reads);
    });
  });
});
