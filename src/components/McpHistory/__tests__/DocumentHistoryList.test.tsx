// WI-AL1.7 — the document's revision list: each row shows who made it (provider, connection and session label; the four principal states distinct), its kind and tool; "Restore this version" restores the row's revision and "Restore to before this change" its parent, neither offered when that text was collected, there is no parent, or the parent row is not listed; a save another actor asked for names that initiator; blocked hunks read "Blocked: reason (origin)" under their last certified revision, which is highlighted, or say the location is unavailable when the journal has none; an unreadable history says so; a truncated list says older revisions are not shown; one restore at a time
// WI-AL2.1b — every live hunk is listed as the writer persisted it: one row per hunk under the revision that made it, with its kind, its state in words and its target range as a neutral position, touching hunks never merged; hunks of revisions the list does not show are listed apart; the writer's own doc-history reply for ab12cd → aX12Yd and a human insert (the golden fixture the Rust controller test checks) renders its two runs as two rows
// WI-AL3.3 — a revision whose write addressed comments lists them under it, an addressed comment the journal no longer holds as "deleted comment"; a row that addressed none lists nothing
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listDocumentHistory, type BlockedHunk, type DocumentHistory, type HistoryRow, type LiveHunk } from "@/services/agentJournal/docHistoryClient";
import writerReply from "@/test/fixtures/agentJournal/docHistoryAb12cd.json";

const restore = vi.hoisted(() => ({
  restoreFromHistory: vi.fn(async () => ({ status: "applied", durable: true, changed: true, resolves: null }) as const),
}));
vi.mock("@/services/agentJournal/historyRestore", () => restore);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toastMock }));

import { DocumentHistoryList } from "../DocumentHistoryList";

const row = (revision: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  revision,
  seq: revision.replace(/\D/g, "") || "1",
  at: Date.UTC(2026, 0, 1, 12, 0, 0),
  kind: "controlled",
  parent: null,
  actor: { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId: "conn-1", sessionLabel: "refactor 長い", displayName: null },
  initiator: null,
  tool: "document.write",
  restore: false,
  collected: false,
  addresses: [],
  ...over,
});

const blocked = (over: Partial<BlockedHunk> = {}): BlockedHunk => ({
  hunkId: "h-1",
  state: "pending",
  reason: "wholeDocumentWrite",
  origin: "store:document-replaced",
  lastCertified: "r2",
  blockedAt: "r3",
  target: "r2",
  ...over,
});

const live = (hunkId: string, from: number, to: number, over: Partial<LiveHunk> = {}): LiveHunk => ({
  hunkId,
  kind: "change",
  state: "pending",
  target: "r2",
  baseRange: { from, to },
  targetRange: { from, to },
  reviewGen: "0",
  span: { from, to },
  editedSince: false,
  ...over,
});

const history = (over: Partial<DocumentHistory> = {}): DocumentHistory => ({
  generation: "1",
  head: "r3",
  rows: [
    row("r3", { parent: "r2", actor: { type: "human" }, kind: "observed", tool: null }),
    row("r2", { parent: "r1" }),
    row("r1", { parent: null }),
  ],
  truncated: false,
  hunks: [],
  blocked: [],
  degraded: false,
  ...over,
});

const rowOf = (revision: string) => screen.getByTestId(`history-row-${revision}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DocumentHistoryList", () => {
  it("shows who made each revision: provider, connection and session label", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
    const r2 = within(rowOf("r2"));
    expect(r2.getByText("claude")).toBeInTheDocument();
    expect(r2.getByText(/conn-1/)).toBeInTheDocument();
    expect(r2.getByText(/refactor 長い/)).toBeInTheDocument();
    expect(r2.getByText("document.write")).toBeInTheDocument();
    expect(within(rowOf("r3")).getByText("You")).toBeInTheDocument();
  });

  it("marks each principal state with its own words and style", () => {
    const actor = (principal: object) => ({ type: "mcp", principal, connectionId: "c", sessionLabel: null, displayName: null }) as HistoryRow["actor"];
    render(
      <DocumentHistoryList
        tabId="t-1"
        docKey="path:/a.md"
        failed={false}
        history={history({
          rows: [
            row("r4", { actor: actor({ state: "provider", provider: "codex" }) }),
            row("r3", { actor: actor({ state: "anonymous" }) }),
            row("r2", { actor: actor({ state: "unrecognized" }) }),
            row("r1", { actor: actor({ state: "ambiguous" }) }),
          ],
        })}
      />,
    );
    const tones = ["r4", "r3", "r2", "r1"].map((r) => rowOf(r).querySelector("[data-tone]")?.getAttribute("data-tone"));
    expect(tones).toEqual(["provider", "anonymous", "unrecognized", "ambiguous"]);
    expect(within(rowOf("r3")).getByText(/unidentified client/i)).toBeInTheDocument();
    expect(within(rowOf("r2")).getByText(/unrecognized credential/i)).toBeInTheDocument();
    expect(within(rowOf("r1")).getByText(/several providers/i)).toBeInTheDocument();
  });

  it("restores a row's own revision, or its parent", async () => {
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
    await user.click(within(rowOf("r2")).getByRole("button", { name: /restore this version/i }));
    expect(restore.restoreFromHistory).toHaveBeenLastCalledWith("t-1", { from: "revision", revision: "r2" });
    await user.click(within(rowOf("r2")).getByRole("button", { name: /restore to before this change/i }));
    expect(restore.restoreFromHistory).toHaveBeenLastCalledWith("t-1", { from: "revision", revision: "r1" });
    expect(toastMock.success).toHaveBeenCalledTimes(2);
  });

  it("offers no restore of a collected text, and no 'before' for the first revision or a collected parent", () => {
    render(
      <DocumentHistoryList
        tabId="t-1"
        docKey="path:/a.md"
        failed={false}
        history={history({ rows: [row("r3", { parent: "r2" }), row("r2", { parent: "r1", collected: true }), row("r1")] })}
      />,
    );
    expect(within(rowOf("r2")).queryByRole("button", { name: /restore this version/i })).toBeNull();
    expect(within(rowOf("r2")).getByText(/text no longer kept/i)).toBeInTheDocument();
    expect(within(rowOf("r3")).queryByRole("button", { name: /restore to before this change/i })).toBeNull();
    expect(within(rowOf("r1")).queryByRole("button", { name: /restore to before this change/i })).toBeNull();
    expect(within(rowOf("r1")).getByRole("button", { name: /restore this version/i })).toBeInTheDocument();
  });

  it("offers no 'before' when the parent row is not listed, since whether its text is kept is unknown", () => {
    render(
      <DocumentHistoryList
        tabId="t-1"
        docKey="path:/a.md"
        failed={false}
        history={history({ truncated: true, rows: [row("r3", { parent: "r2" }), row("r2", { parent: "r1" })] })}
      />,
    );
    expect(within(rowOf("r3")).getByRole("button", { name: /restore to before this change/i })).toBeInTheDocument();
    expect(within(rowOf("r2")).queryByRole("button", { name: /restore to before this change/i })).toBeNull();
    expect(within(rowOf("r2")).getByRole("button", { name: /restore this version/i })).toBeInTheDocument();
  });

  it("shows who asked for a save apart from who wrote the text", () => {
    const agent = row("x").actor;
    render(
      <DocumentHistoryList
        tabId="t-1"
        docKey="path:/a.md"
        failed={false}
        history={history({
          rows: [
            row("r3", { kind: "observed", tool: null, actor: { type: "human" }, initiator: agent }),
            row("r2", { kind: "observed", tool: null, actor: { type: "human" }, initiator: { type: "human" } }),
            row("r1", { kind: "observed", tool: null, actor: { type: "human" }, initiator: null }),
          ],
        })}
      />,
    );
    const r3 = within(rowOf("r3"));
    expect(r3.getByText("You")).toBeInTheDocument();
    expect(r3.getByText(/requested by/i)).toBeInTheDocument();
    expect(r3.getByText("claude")).toBeInTheDocument();
    // The same actor, or none recorded, adds nothing.
    expect(within(rowOf("r2")).queryByText(/requested by/i)).toBeNull();
    expect(within(rowOf("r1")).queryByText(/requested by/i)).toBeNull();
  });

  it("reports an unchanged document and a refused restore", async () => {
    restore.restoreFromHistory
      .mockResolvedValueOnce({ status: "applied", durable: true, changed: false, resolves: null } as never)
      .mockResolvedValueOnce({ status: "aborted", reason: "edited" } as never);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
    await user.click(within(rowOf("r1")).getByRole("button", { name: /restore this version/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    await user.click(within(rowOf("r1")).getByRole("button", { name: /restore this version/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(2));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "a restore the editor failed after applying (durable %s) warns that it was restored but the document needs checking, and that its record is unconfirmed when it is",
    async (durable) => {
      restore.restoreFromHistory.mockResolvedValueOnce({
        status: "appliedWithError", error: new Error("listener crashed"), durable, changed: true, resolves: null,
      } as never);
      const user = userEvent.setup();
      render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
      await user.click(within(rowOf("r1")).getByRole("button", { name: /restore this version/i }));
      // An unconfirmed history record adds its own warning beside it.
      await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(durable ? 1 : 2));
      expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/restored.*editor reported an error.*check the document/i));
      if (!durable) expect(toastMock.warning).toHaveBeenCalledWith(expect.stringMatching(/could not confirm the edit history was saved to disk/i));
      expect(toastMock.error).not.toHaveBeenCalled();
      expect(toastMock.success).not.toHaveBeenCalled();
    },
  );

  it("a restore that could not be confirmed says the document stays locked for agent edits until VMark restarts", async () => {
    restore.restoreFromHistory.mockResolvedValueOnce({ status: "recoveryRequired", error: new Error("tab gone") } as never);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
    await user.click(within(rowOf("r1")).getByRole("button", { name: /restore this version/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/could not confirm.*locked for agent edits until VMark restarts/i));
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("a click while a restore is in flight is ignored", async () => {
    let finish: (v: unknown) => void = () => undefined;
    restore.restoreFromHistory.mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history()} failed={false} />);
    const button = within(rowOf("r1")).getByRole("button", { name: /restore this version/i });
    await user.click(button);
    await user.click(button);
    finish({ status: "applied", durable: true, changed: true, resolves: null });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(restore.restoreFromHistory).toHaveBeenCalledTimes(1);
  });

  it("shows a blocked hunk as 'Blocked: reason (origin)' under its last certified revision, highlighted", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ blocked: [blocked()] })} failed={false} />);
    const r2 = rowOf("r2");
    expect(r2).toHaveAttribute("data-blocked", "true");
    expect(rowOf("r3")).not.toHaveAttribute("data-blocked");
    expect(within(r2).getByText("Blocked: the whole document was replaced (document store)")).toBeInTheDocument();
  });

  it("keeps an unknown origin readable", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ blocked: [blocked({ origin: "schemaV9:新しい" })] })} failed={false} />);
    expect(within(rowOf("r2")).getByText(/Blocked: .*schemaV9:新しい/)).toBeInTheDocument();
  });

  it("says when a blocked hunk has no last certified location, or it is not listed", () => {
    render(
      <DocumentHistoryList
        tabId="t-1"
        docKey="path:/a.md"
        failed={false}
        history={history({ blocked: [blocked({ hunkId: "a", lastCertified: null }), blocked({ hunkId: "b", lastCertified: "r0", reason: "capOverflow", origin: "accumulator" })] })}
      />,
    );
    const orphans = screen.getByRole("list", { name: /last certified location unavailable/i });
    expect(within(orphans).getAllByRole("listitem")).toHaveLength(2);
    expect(within(orphans).getByText(/too many edits to trace/i)).toBeInTheDocument();
    for (const r of ["r1", "r2", "r3"]) expect(rowOf(r)).not.toHaveAttribute("data-blocked");
  });

  it("lists each persisted hunk under the revision that made it, touching hunks as separate rows", () => {
    const hunks = [live("h-a", 0, 1), live("h-b", 1, 2, { kind: "largeChange", state: "reverted" }), live("h-c", 4, 9, { target: "r3", kind: "restore" })];
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ hunks })} failed={false} />);
    const r2 = within(rowOf("r2")).getByRole("list", { name: /changes/i });
    const items = within(r2).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Change (pending), position 0–1", "Large change (reverted), position 1–2"]);
    expect(items.map((li) => li.getAttribute("data-hunk-id"))).toEqual(["h-a", "h-b"]);
    expect(within(rowOf("r3")).getByText("Restore (pending), position 4–9")).toBeInTheDocument();
    expect(within(rowOf("r1")).queryByRole("list", { name: /changes/i })).toBeNull();
  });

  it("renders the writer's reply for two runs and a human insert as two hunk rows", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(writerReply);
    const reply = await listDocumentHistory("doc");
    expect(invoke).toHaveBeenCalledWith("agent_journal_history", { payload: JSON.stringify({ docKey: "doc" }) });
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={reply} failed={false} />);
    const runs = within(rowOf("rev-2")).getByRole("list", { name: /changes/i });
    const items = within(runs).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Change (pending), position 1–2", "Change (pending), position 4–5"]);
    expect(items.map((li) => li.getAttribute("data-hunk-id"))).toEqual(["hunk-1", "hunk-2"]);
    for (const r of ["rev-1", "rev-3"]) expect(within(rowOf(r)).queryByRole("list", { name: /changes/i })).toBeNull();
  });

  it("lists hunks of revisions the list does not show apart, never dropped", () => {
    const hunks = [live("h-old", 3, 3, { target: "r0", kind: "tooComplex" })];
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ hunks, truncated: true })} failed={false} />);
    const older = screen.getByRole("list", { name: /changes in revisions not shown/i });
    expect(within(older).getByText("Too complex to split (pending), position 3–3")).toBeInTheDocument();
  });

  it("lists the comments a revision addressed, a deleted one as deleted comment", () => {
    const addresses = [
      { comment: "c7", deleted: false },
      { comment: "c3", deleted: true },
    ];
    const rows = [row("r2", { parent: "r1", addresses }), row("r1")];
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ rows })} failed={false} />);
    const list = within(rowOf("r2")).getByRole("list", { name: "Addressed comments" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["c7", "deleted comment"]);
    expect(within(rowOf("r1")).queryByRole("list", { name: "Addressed comments" })).toBeNull();
  });

  it("says when older revisions are not shown", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ truncated: true })} failed={false} />);
    expect(screen.getByText(/older revisions are not shown/i)).toBeInTheDocument();
  });

  it("renders a row whose time is outside what a Date can hold, without a time", () => {
    const rows = [row("r2", { at: 9_000_000_000_000_000, parent: "r1" }), row("r1")];
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ rows })} failed={false} />);
    expect(rowOf("r2").querySelector("time")).toBeNull();
    expect(rowOf("r1").querySelector("time")).not.toBeNull();
  });

  it("says when the history cannot be read, and when it is empty", () => {
    const { rerender } = render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={null} failed />);
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    rerender(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history({ rows: [] })} failed={false} />);
    expect(screen.getByText(/no revisions recorded/i)).toBeInTheDocument();
  });
});
