// WI-AL2.4 — the blocked-hunk (widening) indicator: a person deletes and retypes the agent's text in WYSIWYG, so the production collector widens the hunk's span to an uncertified range; the hunk the journal then lists as blocked shows why its automatic revert is unavailable (the break reason and its origin) and offers no revert, while keep stays available
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", async (importOriginal) => ({ ...(await importOriginal<object>()), journalWarn: vi.fn() }));

import { resolveKey } from "@/test/i18nResolve";
import { deleteAndRetype, destroyEditors, flush, freezeDecoded, load, mapHunk, mount, store } from "@/test/wysiwygNetZeroHarness";
import type { BlockedHunk, DocumentHistory, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import type { BreakReason } from "@/services/agentJournal/provenance/accumulator";
import { provenanceSessionFor, startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { ReviewPanel } from "../ReviewPanel";

const T1 = "# Notes\n\na\n\npara two\n\nfar end\n";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);
let stop: (() => void) | null = null;

afterEach(() => {
  destroyEditors();
  stop?.();
  stop = null;
});

/** What the production collector says about the agent's `a` after a WYSIWYG delete-and-retype of it. */
async function widenedBlock(): Promise<{ reason: BreakReason; origin: string }> {
  store().initDocument("t1", T1, "/notes.md");
  stop = startProvenanceSessions();
  provenanceSessionFor("t1")!.fork(T1).recorded("rev-1");
  store().setEditorContent("t1", T1);
  const editor = mount();
  load(editor, T1);
  deleteAndRetype(editor, "a");
  flush(editor);
  const { touched, p } = await freezeDecoded("t1", T1);
  expect(touched).toBe(true);
  const { block } = mapHunk(p, T1, "\na\n");
  expect(block).not.toBeNull();
  return block as { reason: BreakReason; origin: string };
}

function historyBlocking(block: { reason: BreakReason; origin: string }): DocumentHistory {
  const at = T1.indexOf("\na\n");
  const hunk: LiveHunk = {
    hunkId: "h-1",
    kind: "change",
    state: "pending",
    target: "rev-1",
    baseRange: { from: at, to: at + 3 },
    targetRange: { from: at, to: at + 3 },
    reviewGen: "1",
    span: null,
    editedSince: true,
  };
  const blocked: BlockedHunk = { hunkId: "h-1", state: "pending", ...block, lastCertified: "rev-1", blockedAt: null, target: "rev-1" };
  return {
    generation: "3",
    head: "rev-1",
    rows: [
      {
        revision: "rev-1",
        seq: "1",
        at: 1_000,
        kind: "controlled",
        parent: null,
        actor: { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId: "c-1", sessionLabel: null, displayName: null },
        initiator: null,
        tool: "document.write",
        restore: false,
        collected: false,
        addresses: [],
      },
    ],
    truncated: false,
    hunks: [hunk],
    blocked: [blocked],
    degraded: false,
  };
}

describe("ReviewPanel — blocked hunks", () => {
  it("a hunk the production collector widened shows the blocked-hunk indicator", async () => {
    const block = await widenedBlock();
    expect(block).toEqual({ reason: "uncertifiedRange", origin: "wysiwyg:pm-touched" });

    render(<ReviewPanel tabId="t1" docKey="path:/notes.md" history={historyBlocking(block)} onChanged={() => {}} />);

    const row = document.querySelector<HTMLElement>("[data-hunk-id='h-1']")!;
    expect(row).toHaveAttribute("data-blocked", "true");
    // The reason and the editor it came from, in the person's words.
    const message = en("review.hunkBlocked", { reason: en("mcpHistoryReasonUncertifiedRange"), origin: en("mcpHistoryOriginWysiwyg") });
    expect(within(row).getByText(message)).toBeInTheDocument();
    // No automatic revert is offered; keeping it stays a choice.
    expect(within(row).queryByRole("button", { name: en("review.revert") })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: en("review.keep") })).toBeVisible();
    expect(screen.getByRole("list", { name: en("review.listLabel") })).toBeInTheDocument();
  });
});
