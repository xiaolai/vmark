// WI-AL2.4 — "Show both changes" on a revision edited in two windows: only a concurrent row whose text is kept offers it; it loads the pair on demand and shows two labelled whole-document diffs (against the version this save started from, and against the version before it) with the exact inserted and deleted text, CJK and emoji included; a refused or failed read shows an error and no diff, and a later open retries; a diff the worker could not split says so; each scrollable diff is keyboard-focusable under its own name (WI-AL3.2)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resolveKey } from "@/test/i18nResolve";
import type { DocumentHistory, HistoryRow } from "@/services/agentJournal/docHistoryClient";
import { fakeFactory, type FakeFactory } from "@/services/agentJournal/review/__tests__/fakeDiffWorker";

const workers = vi.hoisted(() => ({ current: null as FakeFactory | null }));

vi.mock("@/services/agentJournal/historyRestore", () => ({ restoreFromHistory: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/services/agentJournal/review/diffBudget", async (original) => ({
  ...(await original<typeof import("@/services/agentJournal/review/diffBudget")>()),
  createDiffWorker: () => {
    if (!workers.current) throw new Error("no worker in this test");
    return workers.current.factory();
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { DocumentHistoryList } from "../DocumentHistoryList";

const en = (key: string, options?: Record<string, unknown>) => resolveKey(key, ["statusbar"], options);

const KEY = "path:/two-windows.md";
const PAIR = { observedBefore: "草稿 你好", linearBefore: "草稿 世界!", result: "草稿 世界🎉" };

const row = (revision: string, parent: string | null, over: Partial<HistoryRow> = {}): HistoryRow => ({
  revision,
  seq: revision.slice(1),
  at: 1_000,
  kind: "observed",
  parent,
  actor: { type: "human" },
  initiator: null,
  tool: null,
  restore: false,
  collected: false,
  addresses: [],
  ...over,
});

const history = (rows: HistoryRow[]): DocumentHistory => ({ generation: "1", head: rows[0].revision, rows, truncated: false, hunks: [], blocked: [], degraded: false });
const twoWindows = () => history([row("r3", "r2", { kind: "concurrent" }), row("r2", "r1"), row("r1", null)]);

/** A worker that becomes ready and answers every diff the way the real one would. */
function answeringWorkers(): FakeFactory {
  const f = fakeFactory();
  f.onSpawn = (w) => {
    queueMicrotask(() => w.ready());
    w.onPost = (request) => queueMicrotask(() => w.answer(request));
  };
  return f;
}

function replyWith(reply: () => Promise<unknown>): void {
  vi.mocked(invoke).mockImplementation(async (command: string) => (command === "agent_journal_concurrent_pair" ? reply() : undefined));
}

const corrupt = () => Promise.reject({ code: "internal", message: "JOURNAL_CORRUPT: blob lost", detail: { journalCode: "JOURNAL_CORRUPT" } });

const texts = (region: HTMLElement, tag: "ins" | "del") => Array.from(region.querySelectorAll(tag), (e) => e.textContent);

describe("DocumentHistoryList — show both changes", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    workers.current = answeringWorkers();
  });

  it("offers the control only on a concurrent row whose text is kept", async () => {
    const rows = [row("r4", "r3", { kind: "concurrent", collected: true }), row("r3", "r2", { kind: "concurrent" }), row("r2", "r1"), row("r1", null)];
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={history(rows)} failed={false} />);
    const show = en("review.showBothChanges");
    expect(await within(screen.getByTestId("history-row-r3")).findByRole("button", { name: show })).toBeInTheDocument();
    for (const r of ["r2", "r1"]) expect(within(screen.getByTestId(`history-row-${r}`)).queryByRole("button", { name: show })).toBeNull();
    const collected = screen.getByTestId("history-row-r4");
    expect(within(collected).queryByRole("button", { name: show })).toBeNull();
    expect(within(collected).getByText(en("mcpHistoryTextCollected"))).toBeInTheDocument();
  });

  it("offers no control without a document key", () => {
    render(<DocumentHistoryList tabId="t-1" docKey={null} history={twoWindows()} failed={false} />);
    expect(screen.queryByRole("button", { name: en("review.showBothChanges") })).toBeNull();
  });

  it("loads the pair on demand and shows both labelled diffs exactly", async () => {
    replyWith(async () => PAIR);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    expect(invoke).not.toHaveBeenCalledWith("agent_journal_concurrent_pair", expect.anything());

    const toggle = (await screen.findByRole("button", { name: en("review.showBothChanges") }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    const fromStart = await screen.findByRole("region", { name: en("review.pairAgainstStart") });
    expect(texts(fromStart, "del")).toEqual(["你好"]);
    expect(texts(fromStart, "ins")).toEqual(["世界🎉"]);
    const against = screen.getByRole("region", { name: en("review.pairAgainstBefore") });
    expect(texts(against, "del")).toEqual(["!"]);
    expect(texts(against, "ins")).toEqual(["🎉"]);
    expect(screen.queryByText(en("review.pairCoarse"))).toBeNull();
    // Each scrollable diff is reachable by keyboard, under its own name.
    for (const title of [en("review.pairAgainstStart"), en("review.pairAgainstBefore")]) {
      const text = screen.getByRole("region", { name: en("review.pairDiffText", { title }) });
      expect(text).toHaveAttribute("tabindex", "0");
      expect(text.querySelector("ins, del")).not.toBeNull();
    }
    expect(invoke).toHaveBeenCalledWith("agent_journal_concurrent_pair", expect.objectContaining({ payload: JSON.stringify({ docKey: KEY, revision: "r3" }) }));

    const hide = screen.getByRole("button", { name: en("review.hideBothChanges") });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    await user.click(hide);
    expect(screen.queryByRole("region", { name: en("review.pairAgainstStart") })).toBeNull();
  });

  it("shows an error and no diff when the read is refused, and retries on the next open", async () => {
    replyWith(corrupt);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    expect(await screen.findByRole("alert")).toHaveTextContent(en("review.pairFailed"));
    expect(screen.queryByRole("region", { name: en("review.pairAgainstStart") })).toBeNull();
    expect(screen.queryByRole("region", { name: en("review.pairAgainstBefore") })).toBeNull();

    replyWith(async () => PAIR);
    await user.click(screen.getByRole("button", { name: en("review.hideBothChanges") }));
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    expect(await screen.findByRole("region", { name: en("review.pairAgainstStart") })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error, not a diff, for a malformed reply", async () => {
    replyWith(async () => ({ observedBefore: "a", linearBefore: null, result: "b" }));
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    expect(await screen.findByRole("alert")).toHaveTextContent(en("review.pairFailed"));
    expect(screen.queryByRole("region", { name: en("review.pairAgainstStart") })).toBeNull();
  });

  it("drops a reply that lands after the pair was hidden", async () => {
    let settle: (v: unknown) => void = () => {};
    replyWith(() => new Promise((resolve) => (settle = resolve)));
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    expect(screen.getByRole("status")).toHaveTextContent(en("review.pairLoading"));
    await user.click(screen.getByRole("button", { name: en("review.hideBothChanges") }));
    settle(PAIR);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("region", { name: en("review.pairAgainstStart") })).toBeNull();
  });

  it("says so when the diff was too complex to split", async () => {
    workers.current = null;
    replyWith(async () => PAIR);
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    const fromStart = await screen.findByRole("region", { name: en("review.pairAgainstStart") });
    expect(within(fromStart).getByText(en("review.pairCoarse"))).toBeInTheDocument();
    expect(texts(fromStart, "ins").join("")).toContain("🎉");
  });

  it("says so when a pair has no difference", async () => {
    replyWith(async () => ({ observedBefore: "同じ", linearBefore: "前", result: "同じ" }));
    const user = userEvent.setup();
    render(<DocumentHistoryList tabId="t-1" docKey={KEY} history={twoWindows()} failed={false} />);
    await user.click((await screen.findByRole("button", { name: en("review.showBothChanges") })));
    const fromStart = await screen.findByRole("region", { name: en("review.pairAgainstStart") });
    expect(within(fromStart).getByText(en("review.pairNoDifference"))).toBeInTheDocument();
    expect(texts(fromStart, "ins")).toEqual([]);
  });
});
