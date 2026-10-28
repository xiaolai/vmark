// WI-AL2.4 — the review panel's row model: revisions since the last fully reviewed prefix, grouped by actor and session, each hunk under the revision that made it with its block, hunks of unlisted revisions apart, and the backlog full at the writer's 500-slot limit
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BlockedHunk, DocumentHistory, HistoryRow, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import type { JournalActor } from "@/services/agentJournal/journalActor";
import { measureGrowth, growthExponent } from "@/test/cpuClock";
import { AGENT_SLOT_LIMIT, actorKey, buildReviewModel } from "../reviewRows";

const claude = (connectionId = "c-1", sessionLabel: string | null = null): JournalActor => ({
  type: "mcp",
  principal: { state: "provider", provider: "claude" },
  connectionId,
  sessionLabel,
  displayName: null,
});
const row = (revision: string, actor: JournalActor = claude()): HistoryRow => ({
  revision,
  seq: "1",
  at: 0,
  kind: actor.type === "mcp" ? "controlled" : "observed",
  parent: null,
  actor,
  initiator: null,
  tool: null,
  restore: false,
  collected: false,
  addresses: [],
});
const hunk = (hunkId: string, target: string, state: LiveHunk["state"] = "pending"): LiveHunk => ({
  hunkId,
  kind: "change",
  state,
  target,
  baseRange: { from: 0, to: 1 },
  targetRange: { from: 0, to: 1 },
  reviewGen: "0",
  span: { from: 0, to: 1 },
  editedSince: false,
});
const history = (rows: HistoryRow[], hunks: LiveHunk[], blocked: BlockedHunk[] = []): DocumentHistory => ({
  generation: "1",
  head: rows[0]?.revision ?? null,
  rows,
  truncated: false,
  hunks,
  blocked,
  degraded: false,
});
const shape = (h: DocumentHistory) => buildReviewModel(h).rows.map((r) => (r.type === "hunk" ? r.hunk.hunkId : r.type === "group" ? `group×${r.revisions}` : r.type));

describe("buildReviewModel", () => {
  it("an empty history has no rows, nothing undecided and no backlog", () => {
    expect(buildReviewModel(history([], []))).toEqual({ rows: [], reviewedPrefix: 0, undecided: 0, backlogFull: false });
  });

  it("summarizes the fully reviewed prefix and shows every revision from the oldest undecided one", () => {
    // Newest first: r4 (human save), r3 (kept), r2 (pending), r1 (kept) — r1 is the reviewed prefix.
    const rows = [row("r4", { type: "human" }), row("r3"), row("r2"), row("r1")];
    const h = history(rows, [hunk("a3", "r3", "kept"), hunk("a2", "r2"), hunk("a1", "r1", "kept")]);
    const model = buildReviewModel(h);
    expect(model.reviewedPrefix).toBe(1);
    expect(model.undecided).toBe(1);
    expect(shape(h)).toEqual(["group×1", "group×2", "a3", "a2"]);
  });

  it("a conflicted hunk is undecided too", () => {
    const h = history([row("r2"), row("r1")], [hunk("a2", "r2", "kept"), hunk("a1", "r1", "conflicted")]);
    expect(buildReviewModel(h)).toMatchObject({ reviewedPrefix: 0, undecided: 1 });
  });

  it("with every hunk decided the whole history is the reviewed prefix", () => {
    const h = history([row("r2"), row("r1")], [hunk("a2", "r2", "kept"), hunk("a1", "r1", "reverted")]);
    expect(buildReviewModel(h)).toMatchObject({ rows: [], reviewedPrefix: 2, undecided: 0 });
  });

  it("groups consecutive revisions by actor and session, and splits on another session", () => {
    const rows = [row("r3", claude("c-1", "b")), row("r2", claude("c-1", "a")), row("r1", claude("c-1", "a"))];
    const h = history(rows, [hunk("x3", "r3"), hunk("x2", "r2"), hunk("x1", "r1")]);
    expect(shape(h)).toEqual(["group×1", "x3", "group×2", "x2", "x1"]);
  });

  it("a client's display name does not split a group; another connection does", () => {
    const named = { ...claude(), displayName: "renamed" } as JournalActor;
    expect(actorKey(named)).toBe(actorKey(claude()));
    expect(actorKey(claude("c-2"))).not.toBe(actorKey(claude()));
    expect(actorKey({ type: "system", reason: "autosave" })).not.toBe(actorKey({ type: "system", reason: "reload" }));
  });

  it("keeps the journal's hunk order within a revision", () => {
    const h = history([row("r1")], [hunk("b", "r1"), hunk("a", "r1"), hunk("c", "r1")]);
    expect(shape(h)).toEqual(["group×1", "b", "a", "c"]);
  });

  it("lists hunks of a revision the history does not show apart, never dropping them", () => {
    const h = history([row("r2")], [hunk("a2", "r2"), hunk("old", "r0", "kept")]);
    expect(shape(h)).toEqual(["group×1", "a2", "elsewhere", "old"]);
  });

  it("carries a blocked hunk's block on its row", () => {
    const block: BlockedHunk = { hunkId: "a1", state: "pending", reason: "uncertifiedRange", origin: "wysiwyg:pm-touched", lastCertified: "r1", blockedAt: null, target: "r1" };
    const rows = buildReviewModel(history([row("r1")], [hunk("a1", "r1")], [block])).rows;
    expect(rows[1]).toMatchObject({ type: "hunk", blocked: block });
  });

  it.each([
    [AGENT_SLOT_LIMIT - 1, false],
    [AGENT_SLOT_LIMIT, true],
    [AGENT_SLOT_LIMIT + 100, true],
  ])("%i non-settled hunks: backlog full %s", (n, full) => {
    const hunks = Array.from({ length: n }, (_, i) => hunk(`h${i}`, "r1", "kept"));
    expect(buildReviewModel(history([row("r1")], hunks)).backlogFull).toBe(full);
  });

  it("the slot limit is the writer's", () => {
    const rust = readFileSync(resolve(import.meta.dirname, "../../../../src-tauri/src/agent_journal/review_slots.rs"), "utf8");
    expect(rust).toMatch(new RegExp(`pub const AGENT_SLOT_LIMIT: usize = ${AGENT_SLOT_LIMIT};`));
  });
});

// Grouping hunks by the revision that made them is one pass: a cost quadratic
// in the hunks of one revision reads an exponent of 2 from 400 to 4,000.
describe("buildReviewModel cost", () => {
  it("grows about linearly in the hunks one revision made", () => {
    const SMALL = 400;
    const LARGE = 4_000;
    const build = (n: number) => history([row("r1")], Array.from({ length: n }, (_, i) => hunk(`h${i}`, "r1")));
    const growth = measureGrowth((h: DocumentHistory) => void buildReviewModel(h), build(SMALL), build(LARGE));
    expect(growthExponent(growth, SMALL, LARGE)).toBeLessThan(1.4);
  });
});
