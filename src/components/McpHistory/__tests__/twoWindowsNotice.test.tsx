// WI-AL2.4 — the "edited in two windows" timeline notice: a concurrent revision (a save that started from a different version than the one before it) says it was edited in two windows and keeps both restore actions — its own version and the one before it — so the person can undo the merge; an ordinary revision carries no such notice
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { resolveKey } from "@/test/i18nResolve";
import type { DocumentHistory, HistoryRow } from "@/services/agentJournal/docHistoryClient";

vi.mock("@/services/agentJournal/historyRestore", () => ({ restoreFromHistory: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { DocumentHistoryList } from "../DocumentHistoryList";

const en = (key: string) => resolveKey(key, ["statusbar"]);

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

describe("DocumentHistoryList — edited in two windows", () => {
  it("a concurrent revision says so and offers both restores", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history([row("r3", "r2", { kind: "concurrent" }), row("r2", "r1"), row("r1", null)])} failed={false} />);
    const concurrent = screen.getByTestId("history-row-r3");
    expect(within(concurrent).getByText(en("review.editedInTwoWindows"))).toBeInTheDocument();
    expect(within(concurrent).getByRole("button", { name: en("mcpHistoryRestoreVersion") })).toBeInTheDocument();
    expect(within(concurrent).getByRole("button", { name: en("mcpHistoryRestoreBefore") })).toBeInTheDocument();
  });

  it("an ordinary revision carries no notice", () => {
    render(<DocumentHistoryList tabId="t-1" docKey="path:/a.md" history={history([row("r2", "r1"), row("r1", null)])} failed={false} />);
    expect(screen.queryByText(en("review.editedInTwoWindows"))).not.toBeInTheDocument();
  });
});
