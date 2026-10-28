// WI-AL2.4 — a review row says the one thing the person must know: a hunk that is both conflicted and blocked offers no Revert, so its row names the block that removed it, as well as the conflict. Edge cases: blocked only, conflicted only, edited since
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { resolveKey } from "@/test/i18nResolve";
import type { BlockedHunk, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import { breakReasonLabel, originLabel, type Translate } from "@/components/McpHistory/historyLabels";
import { ReviewHunkRow } from "../ReviewHunkRow";

const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);
const t = en as unknown as Translate;

function hunk(over: Partial<LiveHunk> = {}): LiveHunk {
  return {
    hunkId: "h-1", kind: "change", state: "pending", target: "rev-1",
    baseRange: { from: 1, to: 2 }, targetRange: { from: 1, to: 2 },
    reviewGen: "7", span: { from: 1, to: 2 }, editedSince: false, ...over,
  };
}

const blocked: BlockedHunk = {
  hunkId: "h-1", state: "conflicted", reason: "externalReload", origin: "外部",
  lastCertified: null, blockedAt: null, target: "rev-1",
};

const blockedNote = (b: BlockedHunk) =>
  en("review.hunkBlocked", { reason: breakReasonLabel(b.reason, t), origin: originLabel(b.origin, t) });

const renderRow = (h: LiveHunk, b: BlockedHunk | null) =>
  render(<ReviewHunkRow hunk={h} blocked={b} busy={false} onAction={vi.fn()} />);

describe("ReviewHunkRow notes", () => {
  it("names the block that removed Revert on a conflicted hunk, and the conflict", () => {
    renderRow(hunk({ state: "conflicted", span: null }), blocked);
    expect(screen.queryByRole("button", { name: en("review.revert") })).toBeNull();
    expect(screen.getByText(blockedNote(blocked))).toBeTruthy();
    expect(screen.getByText(en("review.hunkConflicted"))).toBeTruthy();
  });

  it("shows the conflict alone on a conflicted hunk that is not blocked", () => {
    const { container } = renderRow(hunk({ state: "conflicted" }), null);
    expect(container.querySelectorAll(".review-hunk__note")).toHaveLength(1);
    expect(screen.getByText(en("review.hunkConflicted"))).toBeTruthy();
  });

  it("shows the block alone on a blocked pending hunk", () => {
    const { container } = renderRow(hunk({ span: null }), { ...blocked, state: "pending" });
    expect(container.querySelectorAll(".review-hunk__note")).toHaveLength(1);
    expect(screen.getByText(blockedNote(blocked))).toBeTruthy();
    expect(screen.queryByRole("button", { name: en("review.revert") })).toBeNull();
  });

  it("says a hunk was edited since when nothing else applies", () => {
    renderRow(hunk({ editedSince: true }), null);
    expect(screen.getByText(en("review.hunkEditedSince"))).toBeTruthy();
  });
});
