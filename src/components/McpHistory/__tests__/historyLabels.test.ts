// @vitest-environment node
// WI-AL1.7 — the history panel's labels: every principal state reads differently (a provider by name, anonymous, unrecognized and ambiguous each with their own words), the connection id and the client's session label are shown apart, every break reason has its own words, a known origin prefix is named and an unknown one falls back with the raw origin kept, and every revision kind has a label
// WI-AL2.1b — a live hunk reads as its kind, its state in words and its span as a neutral position, every state with its own words
import { describe, it, expect } from "vitest";
import { actorParts, breakReasonLabel, historyTime, hunkLabel, kindLabel, originLabel, type Translate } from "../historyLabels";
import { BREAK_REASONS } from "@/services/agentJournal/provenance/accumulator";
import { REVISION_KINDS, type LiveHunk } from "@/services/agentJournal/docHistoryClient";
import type { JournalActor } from "@/services/agentJournal/journalActor";

/** A translator that shows which key and values it was given. */
const show = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key;
// i18next's overloaded TFunction cannot be written structurally; the helpers only call t(key) and t(key, values).
const t = show as unknown as Translate;

const mcp = (principal: Extract<JournalActor, { type: "mcp" }>["principal"], extra: Partial<Extract<JournalActor, { type: "mcp" }>> = {}): JournalActor => ({
  type: "mcp",
  principal,
  connectionId: "conn-7f3a",
  sessionLabel: null,
  displayName: null,
  ...extra,
});

describe("actorParts", () => {
  it("names a provider and shows its connection and session label apart", () => {
    const parts = actorParts(mcp({ state: "provider", provider: "claude" }, { sessionLabel: "refactor 長い 😀" }), t);
    expect(parts).toEqual({
      tone: "provider",
      who: "claude",
      details: ["mcpHistoryConnection(id=conn-7f3a)", "mcpHistorySession(label=refactor 長い 😀)"],
    });
  });

  it("keeps the four principal states visibly distinct", () => {
    const states = [
      mcp({ state: "provider", provider: "codex" }),
      mcp({ state: "anonymous" }),
      mcp({ state: "unrecognized" }),
      mcp({ state: "ambiguous" }),
    ].map((a) => actorParts(a, t));
    expect(new Set(states.map((s) => s.tone)).size).toBe(4);
    expect(new Set(states.map((s) => s.who)).size).toBe(4);
    expect(states[1].who).toBe("mcpHistoryPrincipalAnonymous");
    expect(states[2].who).toBe("mcpHistoryPrincipalUnrecognized");
    expect(states[3].who).toBe("mcpHistoryPrincipalAmbiguous");
  });

  it("never lets a client's self-chosen name stand in for the provider", () => {
    const parts = actorParts(mcp({ state: "anonymous" }, { displayName: "claude" }), t);
    expect(parts.who).toBe("mcpHistoryPrincipalAnonymous");
    expect(parts.details).toContain("mcpHistoryClientName(name=claude)");
  });

  it("an empty session label is not shown", () => {
    expect(actorParts(mcp({ state: "provider", provider: "claude" }, { sessionLabel: "" }), t).details).toEqual([
      "mcpHistoryConnection(id=conn-7f3a)",
    ]);
  });

  it.each([
    [{ type: "human" } as JournalActor, "mcpHistoryActorYou", "human"],
    [{ type: "legacy" } as JournalActor, "mcpHistoryActorLegacy", "legacy"],
    [{ type: "system", reason: "autosave" } as JournalActor, "mcpHistoryActorAutosave", "system"],
    [{ type: "system", reason: "cosmicRay" } as JournalActor, "mcpHistoryActorSystem(reason=cosmicRay)", "system"],
  ])("labels a non-agent actor %#", (actor, who, tone) => {
    expect(actorParts(actor, t)).toEqual({ tone, who, details: [] });
  });
});

describe("breakReasonLabel", () => {
  it("gives every break reason its own words", () => {
    const labels = BREAK_REASONS.map((r) => breakReasonLabel(r, t));
    expect(new Set(labels).size).toBe(BREAK_REASONS.length);
    expect(labels.every((l) => l.startsWith("mcpHistoryReason"))).toBe(true);
  });
});

describe("originLabel", () => {
  it.each([
    ["wysiwyg:pm-touched", "mcpHistoryOriginWysiwyg"],
    ["source:attach", "mcpHistoryOriginSource"],
    ["store:document-replaced", "mcpHistoryOriginStore"],
    ["save:snapshot", "mcpHistoryOriginSave"],
    ["freeze:unaligned", "mcpHistoryOriginTracking"],
    ["accumulator", "mcpHistoryOriginTracking"],
    ["concurrentObservation", "mcpHistoryOriginConcurrent"],
    ["gap", "mcpHistoryOriginGap"],
    ["mcp", "mcpHistoryOriginMcp"],
    ["watcher", "mcpHistoryOriginWatcher"],
    ["restart", "mcpHistoryOriginRestart"],
    ["restore", "mcpHistoryOriginRestore"],
  ])("names the known origin %s", (origin, key) => {
    expect(originLabel(origin, t)).toBe(key);
  });

  it.each(["", "schemaV9", "constructor", "__proto__:x", "未知:来源"])("falls back for an unknown origin %j, keeping it", (origin) => {
    expect(originLabel(origin, t)).toBe(`mcpHistoryOriginOther(origin=${origin})`);
  });
});

describe("kindLabel", () => {
  it("labels every revision kind differently", () => {
    const labels = REVISION_KINDS.map((k) => kindLabel(k, t));
    expect(new Set(labels).size).toBe(REVISION_KINDS.length);
  });
});

describe("hunkLabel", () => {
  const STATES: LiveHunk["state"][] = ["pending", "kept", "reverted", "conflicted", "superseded", "resolvedByHumanEdit", "settled"];
  const hunk = (state: LiveHunk["state"]): LiveHunk => ({
    hunkId: "h-1",
    kind: "change",
    state,
    target: "r2",
    baseRange: { from: 0, to: 1 },
    targetRange: { from: 0, to: 1 },
    reviewGen: "0",
    span: { from: 0, to: 1 },
    editedSince: false,
  });

  it("names the kind, the state and the span", () => {
    expect(hunkLabel(hunk("pending"), t)).toBe("mcpHistoryHunk(kind=mcpHistoryHunkKindChange,state=mcpHistoryHunkStatePending,from=0,to=1)");
  });

  it("labels every hunk state differently", () => {
    const labels = STATES.map((s) => hunkLabel(hunk(s), t));
    expect(new Set(labels).size).toBe(STATES.length);
  });
});

describe("historyTime", () => {
  it("gives a machine and a readable form of a journal time", () => {
    const at = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(historyTime(at)?.iso).toBe("2026-01-01T12:00:00.000Z");
    expect(historyTime(at)?.text).toEqual(expect.any(String));
  });

  it.each([0, -1, 8_640_000_000_000_000, -8_640_000_000_000_000])("accepts the Date range edge %d", (ms) => {
    expect(historyTime(ms)).not.toBeNull();
  });

  it.each([8_640_000_000_000_001, -8_640_000_000_000_001, Number.MAX_SAFE_INTEGER, Number.NaN, Number.POSITIVE_INFINITY])(
    "has no time for %d, outside what a Date can hold, instead of throwing",
    (ms) => {
      expect(historyTime(ms)).toBeNull();
    },
  );
});
